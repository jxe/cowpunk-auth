import { Form, useActionData } from "@remix-run/react";
import { auth } from "~/config.server";
import { ActionFunctionArgs, LoaderFunctionArgs, json } from "@remix-run/node";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

export async function loader(args: LoaderFunctionArgs) {
  return json({}, {
    headers: {
      ...(await auth.redirectCookieHeader(args.request))
    }
  })
}

export async function action(args: ActionFunctionArgs) {
  const data = await args.request.formData()
  const email = data.get('email') as string
  return await auth.sendLoginCodeAndRedirect(email)
}

export default function LoginScreen() {
  const { error } = useActionData()
  return <div className="grid h-screen place-items-center">
    <Form method="post" className="flex flex-col gap-2 pt-12">
      <h1>
        Enter your email, and we'll send you a code you can use to log in.
      </h1>
      {error && <div className="text-red-500">{error}</div>}
      <Input placeholder="Your email here" type="email" name="email" />
      <Button type="submit"> Send me the code! </Button>
    </Form>
  </div>
}