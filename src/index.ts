import { createCookieSessionStorage, json, redirect, createCookie } from "@remix-run/node";
import Mailgun from "mailgun.js";
import formData from "form-data";
import validator from 'validator';
import jwt from 'jsonwebtoken';

const redirectCookie = createCookie('redirect', {
  path: "/",
  secrets: [env("SESSION_SECRET")],
  sameSite: "lax",
  httpOnly: true,
})

function env(name: string,) {
  if (process.env[name]) return process.env[name]!
  throw new Error(`Missing environment variable: ${name}`)
}

function randomCode(digits: number) {
  let code = ''
  for (let i = 0; i < digits; i++) {
    code += Math.floor(Math.random() * 10)
  }
  return code
}

interface EmailCodeRow {
  email: string
  loginCode: string
  loginCodeExpiresAt: Date
  extraData?: Record<string, any>
}

interface UserRequired {
  email: string
}

interface UserRow {
  id: number | string
  email: string
  role: string[]
}

export type Config<R extends UserRequired, T extends UserRow> = {
  site: string
  loginFrom: string
  users: {
    findUnique: (args: { where: { email: string } | { id: number } }) => Promise<T | null>
    create: (args: { data: R }) => Promise<T>
  }
  emailCodes: {
    findUnique: (args: { where: { email: string } }) => Promise<EmailCodeRow | null>
    findFirst: (args: { where: { email: string, loginCode: string } }) => Promise<EmailCodeRow | null>
    upsert: (args: {
      where: { email: string },
      create: EmailCodeRow,
      update: Omit<EmailCodeRow, 'email'>
    }) => Promise<EmailCodeRow>
  }
  normalizeEmailOptions?: validator.NormalizeEmailOptions
}

export function cowpunkify<R extends UserRequired, T extends UserRow>(config: Config<R, T>) {
  const punk = {
    config,

    storage: createCookieSessionStorage({
      cookie: {
        name: "session",
        // normally you want this to be `secure: true`
        // but that doesn't work on localhost for Safari
        // https://web.dev/when-to-use-local-https/
        secure: process.env.NODE_ENV === "production",
        secrets: [env("SESSION_SECRET")],
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        httpOnly: true,
      },
    }),

    signOauthToken(userId: number, clientId: string) {
      return jwt.sign({ userId, clientId }, env('JWT_SECRET'), { expiresIn: '1h' })
    },

    async getOauthToken(request: Request) {
      const authHeader = request.headers.get("Authorization")
      if (!authHeader) return null
      const token = authHeader.split(" ")[1]
      return jwt.verify(token, env('JWT_SECRET')) as { userId: number } | null
    },

    async getSession(request: Request) {
      return await this.storage.getSession(request.headers.get("Cookie"))
    },

    async getUserId(request: Request) {
      const oauthToken = await this.getOauthToken(request)
      if (oauthToken) return oauthToken.userId
      const session = await this.getSession(request)
      if (session.has('userId')) return session.get('userId') as number
      return null
    },

    async ensureAPIAuthorized(request: Request) {
      const oauthToken = await this.getOauthToken(request)
      if (!oauthToken) throw new Error("Invalid authorization token.")
      return oauthToken as { userId: number, clientId: string }
    },

    async ensureLoggedIn(request: Request, extraParams = {}) {
      const userId = await this.getUserId(request)
      if (userId) return userId
      const params = new URLSearchParams({ redirect: request.url, ...extraParams });
      throw redirect(`/auth/login?${params.toString()}`)
    },

    async getCurrentUser(request: Request) {
      const userId = await this.getUserId(request)
      if (!userId) return null
      return await config.users.findUnique({ where: { id: userId } })
    },

    async mail({ to, from = config.loginFrom, subject, text }: { to: string, subject: string, text: string, from?: string }) {
      const mailgun = new Mailgun(formData).client({
        username: 'api',
        key: env("MAILGUN_API_KEY"),
        url: process.env["MAILGUN_URL"] || undefined,
      })
      await mailgun.messages.create(process.env["MAILGUN_DOMAIN"]!, {
        from,
        to,
        subject,
        text
      });
    },

    async sendLoginCode(email: string, code: string) {
      await this.mail({
        to: email,
        subject: "Your login code",
        text: `Here's your login code for ${config.site}.\n\n   ${code}`
      })
    },

    normalizeEmail(email: string): string {
      return validator.normalizeEmail(email, config.normalizeEmailOptions) as string
    },

    async resendLoginCode(email: string) {
      if (!email || !validator.isEmail(email)) throw new Error('Invalid email')
      email = punk.normalizeEmail(email)
      const entry = await config.emailCodes.findUnique({ where: { email } })
      if (!entry) throw new Error('no code found')
      this.sendLoginCode(email, entry.loginCode)
      return json({ resent: true })
    },

    async redirectCookieHeader(request: Request) {
      const url = new URL(request.url)
      const redirect = url.searchParams.get('redirect') || '/'
      return redirect ? { "Set-Cookie": await redirectCookie.serialize(redirect) } : undefined
    },

    async generateAndSendLoginCode(email: string, { requireUser }: { requireUser?: boolean }, extraData = {}) {
      // validate email
      if (!email || !validator.isEmail(email)) return { success: false, error: 'Invalid email' }
      email = punk.normalizeEmail(email)
      const user = await config.users.findUnique({ where: { email } })
      if (!user && requireUser) return {
        success: false,
        error: 'User not found',
        foundUser: false
      }

      // create login code
      const loginCode = randomCode(6)
      const loginCodeExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24)
      await config.emailCodes.upsert({
        where: { email },
        create: { email, loginCode, loginCodeExpiresAt, extraData },
        update: { loginCode, loginCodeExpiresAt, extraData }
      })

      // send login code & redirect
      await punk.sendLoginCode(email, loginCode)
      return {
        success: true,
        foundUser: !!user
      }
    },

    // (DEPRECATED) called from auth.login
    async sendLoginCodeAndRedirect(email: string) {
      const result = await this.generateAndSendLoginCode(email, { requireUser: false })
      if (result.error) throw json({ error: result.error })
      const search = new URLSearchParams({ email })
      if (!result.foundUser) search.set('register', 'yes')
      return redirect(`/auth/code?${search.toString()}`)
    },

    async redirectAsLoggedOut(request: Request) {
      const params = new URL(request.url).searchParams
      const redirectTo = params.get('redirect') || '/'
      const session = await punk.storage.getSession(request.headers.get("Cookie"))
      session.unset('userId')
      session.unset('email')
      session.unset('roles')
      return redirect(redirectTo, {
        headers: {
          "Set-Cookie": await punk.storage.commitSession(session),
        },
      });
    },

    // called from auth.code
    async getUserForLoginCodeRequest({ email, code }: {
      email: string,
      code: string,
    }) {
      if (!email || !validator.isEmail(email)) throw new Error('Invalid email')
      if (!code) throw json({ error: "Please enter a code" });
      email = punk.normalizeEmail(email)
      const entry = await config.emailCodes.findFirst({ where: { email, loginCode: code } })
      if (!entry) throw json({ error: "Invalid code" });
      if (entry.loginCodeExpiresAt < new Date()) throw json({ error: "Code expired" });
      const user = config.users.findUnique({ where: { email } })
      if (!user) throw new Error("User not found")
      return user
    },

    // called from auth.code
    async verifyLoginCodeRequest({ email, code }: {
      email: string,
      code: string,
    }) {
      if (!email || !validator.isEmail(email)) throw new Error('Invalid email')
      if (!code) throw json({ error: "Please enter a code" });
      email = punk.normalizeEmail(email)
      const entry = await config.emailCodes.findFirst({ where: { email, loginCode: code } })
      if (!entry) throw json({ error: "Invalid code" });
      if (entry.loginCodeExpiresAt < new Date()) throw json({ error: "Code expired" })
      return entry
    },

    // (DEPRECATED) called from auth.code
    async registerUserFromLoginCodeRequest({ email, code, extraUserFields }: {
      email: string,
      code: string,
      extraUserFields: Omit<R, "email">
    }) {
      await punk.verifyLoginCodeRequest({ email, code })
      return await config.users.create({ data: { email, ...extraUserFields } as R })
    },

    // called from auth.code
    async redirectAsLoggedIn(request: Request, user: T) {
      const redirectTo = await redirectCookie.parse(request.headers.get("Cookie") || "") || "/"
      const session = await punk.storage.getSession()
      session.set('userId', user.id)
      session.set('email', user.email)
      session.set("roles", [...user.role || []])
      return redirect(redirectTo, {
        headers: {
          "Set-Cookie": await punk.storage.commitSession(session),
        },
      });
    }
  }
  return punk
}
