To install, put something like this in `app/routes/root.tsx`

```typescript
export async function loader({ request }: LoaderArgs) {
  return json({ user: await auth.getCurrentUser(request) })
}

export function useCurrentUser() {
  const { user } = useRouteLoaderData("root") as SerializeFrom<typeof loader>
  return user
}
```

Add a file called `app/config.server.ts` with something like this:

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

and copy over the routes in `example/app/routes/auth`!
