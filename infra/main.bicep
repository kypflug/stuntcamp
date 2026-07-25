// One Free-tier Static Web App holds the hub index at / and every hosted app at
// /a/<slug>/. Cloudflare fronts it, so no custom domains are configured here.
@description('Static Web App name.')
param name string = 'swa-stuntcamp'

@description('Static Web Apps is only available in a subset of regions.')
@allowed([
  'westus2'
  'centralus'
  'eastus2'
  'westeurope'
  'eastasia'
])
param location string = 'westus2'

resource site 'Microsoft.Web/staticSites@2023-12-01' = {
  name: name
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Disabled'
    enterpriseGradeCdnStatus: 'Disabled'
  }
}

output name string = site.name
output defaultHostname string = site.properties.defaultHostname
