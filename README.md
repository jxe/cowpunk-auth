To install, add a file called `app/config.server.ts` with something like this:

```typescript
import { PrismaClient } from '@prisma/client'
import { cowpunkify } from 'cowpunk-auth'

export const db = new PrismaClient()

export const auth = cowpunkify({
  site: 'Your Fabulous Site',
  loginFrom: 'Login Codez <info@yoursite.com>',
  users: db.user,
  emailCodes: db.emailCodes,
})
```

Copy over the routes in `example-routes`, and put something like this in `app/routes/root.tsx` so you can get the current user in your routes:

```typescript
export async function loader({ request }: LoaderArgs) {
  return json({ user: await auth.getCurrentUser(request) })
}

export function useCurrentUser() {
  const { user } = useRouteLoaderData("root") as SerializeFrom<typeof loader>
  return user
}
```

Finally, if you have a navbar, put something like this:

```typescript
  const user = useCurrentUser()
  const loginButton = user ? user.name : <Link to="/auth/login">Login</Link>
```
