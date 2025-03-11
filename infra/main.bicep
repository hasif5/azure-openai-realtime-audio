@description('The Azure region for all resources')
param location string = resourceGroup().location

@description('Name of the Container Apps Environment')
param containerAppEnvName string = 'realtime-env'

@description('Name of the realtime-backend Container App')
param realtimeBackendName string = 'realtime-backend'

@description('Name of the realtime-frontend Container App')
param realtimeFrontendName string = 'realtime-frontend'

// ===========================================================
// Create the Container Apps Environment
// ===========================================================
resource containerEnv 'Microsoft.App/managedEnvironments@2024-10-02-preview' = {
  name: containerAppEnvName
  location: location
  properties: {
    // For a production workload, you might configure Log Analytics here.
    // In this example we keep it minimal.
  }
}

// ===========================================================
// realtime-backend Container App (from ACR image)
// ===========================================================
resource realtimeBackend 'Microsoft.App/containerApps@2024-10-02-preview' = {
  name: realtimeBackendName
  location: location
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      registries: [
        {
          server: '<your-acr>.azurecr.io'
          username: '<your-acr-username>'
          passwordSecretRef: 'acr-password'
        }
      ]
      // Expose the frontend externally on port 8080.
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'acr-password'
          value: '<your-acr-password>'
        }
        {
          name: 'azure-openai-realtime-endpoint'
          value: 'wss://<your-endpoint>.openai.azure.com/'
        }
        {
          name: 'azure-openai-api-key'
          value: '<your-api-key>'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'realtime-backend'
          image: '<your-acr>.azurecr.io/realtime-backend:latest'
          resources: {
            cpu: 1
            memory: '2Gi'
          }
          env: [
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              secretRef: 'azure-openai-realtime-endpoint'
            }
            {
              name: 'AZURE_OPENAI_API_KEY'
              secretRef: 'azure-openai-api-key'
            }
            {
              name: 'AZURE_OPENAI_DEPLOYMENT'
              value: 'gpt-4o-mini-realtime-preview'
            }
            {
              name: 'BACKEND'
              value: 'azure'
            }
            {
              name: 'PORT'
              value: '8080'
            }
          ]
          volumeMounts: [
            {
              volumeName: 'cache'
              mountPath: '/cache'
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'cache'
          storageType: 'EmptyDir'
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// ===========================================================
// realtime-frontend Container App (from ACR image)
// ===========================================================
resource realtimeFrontend 'Microsoft.App/containerApps@2024-10-02-preview' = {
  name: realtimeFrontendName
  location: location
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      registries: [
        {
          server: '<your-acr>.azurecr.io'
          username: '<your-acr-username>'
          passwordSecretRef: 'acr-password'
        }
      ]
      // Expose the frontend externally on port 3000.
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'acr-password'
          value: '<your-acr-password>'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'realtime-frontend'
          image: '<your-acr>.azurecr.io/realtime-frontend:latest'
            env: [
            {
              name: 'NEXT_PUBLIC_BACKEND_ENDPOINT'
              value: 'wss://${realtimeBackend.properties.configuration.ingress.fqdn}/realtime'
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// ===========================================================
// Outputs
// ===========================================================
output realtimeFrontendUrl string = 'https://${realtimeFrontend.properties.configuration.ingress.fqdn}'
output realtimeBackendUrl string = 'wss://${realtimeBackend.properties.configuration.ingress.fqdn}'
