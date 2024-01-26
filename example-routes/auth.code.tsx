import { ActionFunctionArgs, json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { auth } from "~/config.server";

export async function loader() {
  return json({ LOGIN_EMAIL_FROM: auth.config.loginFrom })
}

export async function action({ request }: ActionFunctionArgs) {
  const data = await request.clone().formData()
  const params = new URL(request.url).searchParams
  if (data.get('resend')) return auth.resendLoginCode(params.get('email') as string)
  const register = params.get('register') === 'yes'
  const user = register ?
    await auth.registerUserFromLoginCodeRequest(request, ['name', 'handle']) :
    await auth.getUserForLoginCodeRequest(request)
  if (!user) throw new Error("Unrecognized code")
  return auth.redirectAsLoggedIn(request, user)
}

export default function CodeScreen() {
  const { resent, error } = useActionData<{ resent?: boolean, error?: string }>()
  const [params] = useSearchParams()
  const register = params.get('register') === 'yes'
  const buttonTitle = register ? "Register" : "Let me in!"
  const [canResend, setCanResend] = useState<boolean>(false)
  const { LOGIN_EMAIL_FROM } = useLoaderData<typeof loader>()
  useEffect(() => {
    const timeout = setTimeout(() => setCanResend(true), 10_000)
    return () => { clearTimeout(timeout) }
  }, [])

  return <div className="grid h-screen place-items-center">
    <Form method="post" className="flex flex-col gap-2 pt-12">
      <h1>
        {error || <>
          Please check your email for a six digit code!<br /> (Look for an email from {LOGIN_EMAIL_FROM})
        </>}
      </h1>
      <Input placeholder="Six digit code" type="number" name="code" />
      {register ? <>
        <Input placeholder="Your name" type="text" name="name" />
        <Input placeholder="username" type="text" name="handle" pattern="^[a-z0-9_]+$" />
      </> : null}
      <Button type="submit"> {buttonTitle} </Button>
    </Form>
    <Form method="post">
      <Button name="resend" value="yes" disabled={!canResend} type="submit" > Resend code </Button>
      {resent ? "Re-sent!" : null}
    </Form>
  </div>
}
