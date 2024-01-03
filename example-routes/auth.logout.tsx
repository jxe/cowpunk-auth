import { LoaderFunctionArgs } from "@remix-run/node";
import { auth } from "~/config.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return await auth.redirectAsLoggedOut(request)
}
