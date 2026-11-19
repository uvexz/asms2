import { createFileRoute, getRouteApi } from '@tanstack/react-router'

import { LandingPage } from '#/components/marketing/landing-page'

const rootApi = getRouteApi('__root__')

export const Route = createFileRoute('/')({
  component: LandingRoute,
})

function LandingRoute() {
  const { site } = rootApi.useLoaderData()
  const { session } = rootApi.useRouteContext()

  return <LandingPage site={site} signedIn={Boolean(session)} />
}
