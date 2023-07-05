import { type ActionArgs, type LoaderArgs, createCookieSessionStorage, json, redirect } from "@remix-run/node";
import Mailgun from "mailgun.js";
import formData from "form-data";
import validator from 'validator';

function env(name: string) {
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

export interface Config {
  site: string
  loginFrom: string
  users: {
    findUnique: (args: { where: { email: string } | { id: number } }) => Promise<{ id: number | string, email: string, role: string[] } | null>
  }
  emailCodes: {
    findUnique: (args: { where: { email: string } }) => Promise<{ loginCode: string, loginCodeExpiresAt: Date } | null>
    findFirst: (args: { where: { email: string, loginCode: string } }) => Promise<{ loginCode: string, loginCodeExpiresAt: Date } | null>
    upsert: (args: { where: { email: string }, create: { email: string, loginCode: string, loginCodeExpiresAt: Date }, update: { loginCode: string, loginCodeExpiresAt: Date } }) => Promise<{ loginCode: string, loginCodeExpiresAt: Date }>
  }
}

export function cowpunkify(config: Config) {
  return {
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

    async getCurrentUser(request: Request) {
      const userId = (await this.storage.getSession(request.headers.get("Cookie"))).get('userId')
      if (!userId) return null
      return await config.users.findUnique({ where: { id: userId } })
    },

    async upsertLoginCode(email: string) {
      const loginCode = randomCode(6)
      const loginCodeExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24)
      await config.emailCodes.upsert({
        where: { email },
        create: { email, loginCode, loginCodeExpiresAt },
        update: { loginCode, loginCodeExpiresAt }
      })
      return loginCode
    },

    async userByEmail(email: string) {
      return await config.users.findUnique({ where: { email } })
    },

    async sendLoginCode(email: string, code: string) {
      const mailgun = new Mailgun(formData).client({ username: 'api', key: env("MAILGUN_API_KEY") })
      await mailgun.messages.create(env("MAILGUN_DOMAIN"), {
        from: config.loginFrom,
        to: email,
        subject: "Your login code",
        text: `Here's your login code for ${config.site}.\n\n   ${code}`
      });
    },

    async resendLoginCode(email: string) {
      const entry = await config.emailCodes.findUnique({ where: { email } })
      if (!entry) throw new Error('no code found')
      this.sendLoginCode(email, entry.loginCode)
    },

    async userForLoginCode(email: string, code: string) {
      const entry = await config.emailCodes.findFirst({
        where: { email, loginCode: code },
      })
      if (!entry) throw new Error("Invalid code")
      if (entry.loginCodeExpiresAt < new Date()) throw new Error("Code expired")
      let user = await this.userByEmail(email)
      if (!user) throw new Error('User not found')
      return user
    },

    async loginSubmitAction({ request }: ActionArgs) {
      const data = await request.formData()
      let email = data.get('email') as string
      if (!email || !validator.isEmail(email)) throw new Error('Invalid email')
      email = validator.normalizeEmail(email) as string
      const redirectURL = data.get('redirect') as string | undefined
      const user = await this.userByEmail(email)
      if (!user) throw new Error('User not found')
      const loginCode = await this.upsertLoginCode(email)
      await this.sendLoginCode(email, loginCode)
      const search = new URLSearchParams()
      search.set('email', email)
      if (redirectURL) search.set('successRedirect', redirectURL)
      return redirect(`/auth/code?${search.toString()}`)
    },

    async codeLoader({ request }: LoaderArgs) {
      const url = new URL(request.url)
      const email = url.searchParams.get('email')
      if (!email || !validator.isEmail(email)) throw redirect('/auth/login')
      return json({ LOGIN_EMAIL_FROM: this.config.loginFrom, })
    },

    async codeSubmitAction({ request }: ActionArgs) {
      const data = await request.formData()
      let email = data.get('email') as string
      if (!email || !validator.isEmail(email)) throw new Error('Invalid email')
      email = validator.normalizeEmail(email) as string
      if (data.get('resend')) {
        await this.resendLoginCode(email)
        return json({ resent: true })
      } else {
        let code = data.get("code") as string
        if (!email || !code) throw new Error("Missing email or code");
        const user = await this.userForLoginCode(email, code)
        const redirectTo = data.get("successRedirect") as string || "/"
        const session = await this.storage.getSession()
        session.set('userId', user.id)
        session.set('email', email)
        session.set("roles", [...user.role || []])
        return redirect(redirectTo, {
          headers: {
            "Set-Cookie": await this.storage.commitSession(session),
          },
        });
      }
    }
  }
}
