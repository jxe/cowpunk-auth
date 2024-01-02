import { ActionArgs } from "@remix-run/node";
import { auth } from "~/config.server";

export async function action(request: ActionArgs) {
  return await auth.logoutAction(request)
}
