import { expect } from "chai"

import { HerdLoader, TDockerMetadataLoader, THerdLoader } from "./herd-loader"
import * as path from "path"
import * as fs from "fs"
import {
  IAnyDeploymentAction,
  IDeploymentOrchestration,
  IDockerDeploymentAction,
  IK8sDirDeploymentAction,
  IK8sDockerImageDeploymentAction,
  ILog,
  TActionExecutionOptions,
  TFolderHerdDeclaration,
  THerdSectionType,
} from "../deployment-types"
import { detectRecursion } from "../helpers/obj-functions"
import { CreateFakeLogger, IFakeLogging } from "../test-tools/fake-logger"
import { TFileSystemPath } from "../helpers/basic-types"
import { TFeatureDeploymentConfig } from "../triggered-deployment/create-upstream-trigger-deployment-config"
import {
  DeploymentPlanFactory,
  IDeploymentPlan,
  TDeploymentPlanDependencies,
} from "../deployment-plan/deployment-plan-factory"
import { createFakeStateStore } from "@shepherdorg/state-store/dist/fake-state-store-factory"
import { createFakeUIPusher } from "../deployment-orchestration/deployment-orchestration.spec"

const exec = require("@shepherdorg/exec")

/// Inject a mock image metadata loader with fake image information

const CreateFeatureDeploymentConfig = require("../triggered-deployment/create-upstream-trigger-deployment-config")
  .CreateUpstreamTriggerDeploymentConfig

export interface TTestDeploymentOrchestration extends IDeploymentOrchestration {
  addedDeploymentPlans: Array<IDeploymentPlan>
  // TODO Remove tests on deploymentActions
  addedK8sDeploymentActions: { [key: string]: IK8sDockerImageDeploymentAction | IK8sDirDeploymentAction }
  addedDockerDeployerActions: { [key: string]: IDockerDeploymentAction }
}

type FCreateTestReleasePlan = () => TTestDeploymentOrchestration

describe("herd.yaml loading", function() {
  let labelsLoader: TDockerMetadataLoader
  let loader: THerdLoader
  let CreateTestReleasePlan: FCreateTestReleasePlan
  let loaderLogger: IFakeLogging

  let featureDeploymentConfig = CreateFeatureDeploymentConfig()

  function createTestHerdLoader(
    labelsLoader: TDockerMetadataLoader,
    featureDeploymentConfig: TFeatureDeploymentConfig
  ) {
    let dependencies: TDeploymentPlanDependencies = {
      cmd: undefined,
      logger: loaderLogger,
      stateStore: createFakeStateStore(),
      uiDataPusher: createFakeUIPusher()
    }
    loader = HerdLoader({
      logger: loaderLogger,
      deploymentOrchestration: CreateTestReleasePlan(),
      exec: exec,
      labelsLoader: labelsLoader,
      featureDeploymentConfig,
      planFactory: DeploymentPlanFactory(dependencies),
    })
  }

  afterEach(() => {
    delete process.env.www_icelandair_com_image
    delete process.env.SUB_DOMAIN_PREFIX
    delete process.env.PREFIXED_TOP_DOMAIN_NAME
    delete process.env.MICROSERVICES_POSTGRES_RDS_HOST
    delete process.env.MICRO_SITES_DB_PASSWORD
    delete process.env.WWW_ICELANDAIR_IP_WHITELIST
    delete process.env.EXPORT1
    delete process.env.EXPORT2
    delete process.env.GLOBAL_MIGRATION_ENV_VARIABLE_ONE
    delete process.env.INFRASTRUCTURE_IMPORTED_ENV
  })

  beforeEach(() => {
    process.env.www_icelandair_com_image = "testimage123"
    process.env.SUB_DOMAIN_PREFIX = "testing123"
    process.env.PREFIXED_TOP_DOMAIN_NAME = "testing123"
    process.env.MICROSERVICES_POSTGRES_RDS_HOST = "testing123"
    process.env.MICRO_SITES_DB_PASSWORD = "testing123"
    process.env.WWW_ICELANDAIR_IP_WHITELIST = "YnVsbHNoaXRsaXN0Cg=="
    process.env.GLOBAL_MIGRATION_ENV_VARIABLE_ONE = "anotherValue"
    process.env.INFRASTRUCTURE_IMPORTED_ENV = "thatsme"

    delete process.env.TPL_DOCKER_IMAGE

    process.env.EXPORT1 = "NotFromInfrastructureAnyMore"
    process.env.EXPORT2 = "NeitherFromInfrastructure"


    CreateTestReleasePlan = function() {
      let addedK8sDeployerActions: { [key: string]: IK8sDockerImageDeploymentAction } = {}
      let addedDockerDeployerActions: { [key: string]: IDockerDeploymentAction } = {}

      let deploymentPlans:Array<IDeploymentPlan>=[]
      function addDeploymentAction(deploymentAction: IAnyDeploymentAction) {
        let addPromise : Promise<IAnyDeploymentAction> = new Promise(function(resolve, reject) {
          setTimeout(() => {
            if (!deploymentAction.type) {
              let message = "Illegal deployment, no deployment type attribute in " + JSON.stringify(deploymentAction)
              reject(new Error(message))
            }
            if (!deploymentAction.identifier) {
              let message = "Illegal deployment, no identifier attribute in " + JSON.stringify(deploymentAction)
              reject(new Error(message))
            }
            if (deploymentAction.type === "k8s") {
              releasePlan.addedK8sDeploymentActions[
                deploymentAction.identifier
                ] = deploymentAction as IK8sDockerImageDeploymentAction
            } else if (deploymentAction.type === "deployer") {
              releasePlan.addedDockerDeployerActions[deploymentAction.identifier] = deploymentAction as IDockerDeploymentAction
            }
            resolve(deploymentAction)
          }, 1)
        })
        return addPromise
      }


      let releasePlan: TTestDeploymentOrchestration = {
        executePlans: function(_p1: TActionExecutionOptions) {
          return Promise.resolve([])
        },
        exportDeploymentActions: function(_p1: TFileSystemPath) {
          return Promise.resolve()
        },
        printPlan: function(_p1: ILog) { return false},
        addedDockerDeployerActions: addedDockerDeployerActions,
        addedK8sDeploymentActions: addedK8sDeployerActions,
        addedDeploymentPlans: deploymentPlans,
        // TODO addDeployentPlan(deploymentPlan: IDeploymentPlan)
        async addDeploymentPlan(deploymentPlan: IDeploymentPlan): Promise<IDeploymentPlan> {
          await Promise.all(deploymentPlan.deploymentActions.map(async (da)=>{
            await addDeploymentAction(da as IAnyDeploymentAction)
          }))
          deploymentPlans.push(deploymentPlan)
          return deploymentPlan
        }
      }
      return releasePlan
    }

    loaderLogger = CreateFakeLogger()

    labelsLoader = {
      getDockerRegistryClientsFromConfig() {
        return {}
      },
      imageLabelsLoader(_injected: any) {
        return {
          getImageLabels(imageDef) {
            let dockerImageMetadataFile = path.join(
              __dirname,
              "testdata",
              "inspected-dockers",
              imageDef.image + ".json"
            )
            if (fs.existsSync(dockerImageMetadataFile)) {
              const dockerInspection = require(dockerImageMetadataFile)

              return Promise.resolve({
                dockerLabels: dockerInspection[0].ContainerConfig.Labels,
                imageDefinition: imageDef,
              })
            } else {
              return Promise.reject(
                new Error(
                  `dockerImageMetadataFile ${dockerImageMetadataFile} for ${imageDef.image}:${imageDef.imagetag} not found in testdata`
                )
              )
            }
          },
        }
      },
    }

    createTestHerdLoader(labelsLoader, featureDeploymentConfig)
  })

  it("should load herd.yaml", function() {
    return loader.loadHerd(__dirname + "/testdata/happypath/herd.yaml").then(function(plan) {
      expect(plan).not.to.equal(undefined)
    })
  })

  it("should fail if file does not exist", function() {
    loader
      .loadHerd(__dirname + "/testdata/does-not-exist.yaml")
      .then(function() {
        expect.fail("Should not finish!")
      })
      .catch(function(error) {
        expect(error.message).to.contain("/testdata/does-not-exist.yaml does not exist!")
      })
  })

  /* TODO Probably should move this test block to testing the folder deployment plan loader directly. Limit to checking that folder deployment planner is invoked correctly. */
  describe("folder execution plan loading", function() {
    let loadedPlan: TTestDeploymentOrchestration

    before(() => {
      process.env.GLOBAL_MIGRATION_ENV_VARIABLE_ONE = "anotherValue"
    })

    after(() => {
      delete process.env.GLOBAL_MIGRATION_ENV_VARIABLE_ONE
    })

    beforeEach(function() {
      return loader.loadHerd(__dirname + "/testdata/happypath/herd.yaml").then(function(orchestration) {
        loadedPlan = orchestration as TTestDeploymentOrchestration
      })
    })

    it("should add k8s deployment found in scanned directory", function() {
      expect(loadedPlan.addedK8sDeploymentActions["Namespace_monitors"].origin).to.equal(
        "namespaces/monitors-namespace.yml"
      )
    })

    it("loaded plan should have herd name", function() {
      expect(loadedPlan.addedK8sDeploymentActions["Namespace_monitors"].herdKey).to.contain("kube-config - namespaces")
    })

    it("should have herdDeclaration", () => {
      expect(loadedPlan.addedK8sDeploymentActions["Namespace_monitors"].herdDeclaration.key).to.equal("kube-config")
      expect(
        (loadedPlan.addedK8sDeploymentActions["Namespace_monitors"].herdDeclaration as TFolderHerdDeclaration).path
      ).to.equal("./")
      expect(loadedPlan.addedK8sDeploymentActions["Namespace_monitors"].herdDeclaration.description).to.equal(
        "Kubernetes pull secrets, namespaces, common config"
      )

      expect(
        loadedPlan.addedK8sDeploymentActions["Namespace_monitors"].herdDeclaration.sectionDeclaration
      ).to.deep.equal({
        herdSectionIndex: 1,
        herdSectionType: "folders" as THerdSectionType,
      })
    })

    it("should have metadata in dir execution plan", () => {
      let expectedMetadata = {
        displayName: "monitors-namespace.yml",
        semanticVersion: "none",
        deploymentType: "k8s",
        path: "namespaces/monitors-namespace.yml",
        buildDate: loadedPlan.addedK8sDeploymentActions["Namespace_monitors"].metadata.buildDate,
        hyperlinks: [],
      }
      expect(loadedPlan.addedK8sDeploymentActions["Namespace_monitors"].metadata).to.deep.equal(expectedMetadata)
    })
  })

  describe("k8s feature deployment plan", function() {
    let loadedPlan: TTestDeploymentOrchestration

    before(() => {
      featureDeploymentConfig.imageFileName = "feature-deployment"
      featureDeploymentConfig.upstreamHerdKey = "herdkeyone"
      featureDeploymentConfig.upstreamImageName = "testenvimage"
      featureDeploymentConfig.upstreamImageTag = "9999"
      featureDeploymentConfig.upstreamHerdDescription = "Very much a testing image"
      featureDeploymentConfig.upstreamFeatureDeployment = true
      featureDeploymentConfig.ttlHours = "22"
      featureDeploymentConfig.branchName = "feature-XYZ"
    })

    after(() => {
      featureDeploymentConfig.upstreamFeatureDeployment = false

      delete featureDeploymentConfig.imageFileName
      delete featureDeploymentConfig.upstreamHerdKey
      delete featureDeploymentConfig.upstreamImageName
      delete featureDeploymentConfig.upstreamImageTag
      delete featureDeploymentConfig.upstreamHerdDescription
      delete featureDeploymentConfig.ttlHours
      delete featureDeploymentConfig.branchName
    })

    beforeEach(function() {
      return loader.loadHerd(__dirname + "/testdata/happypath/herd.yaml").then(function(plan) {
        loadedPlan = plan as TTestDeploymentOrchestration
      })
    })

    it("should create plan from feature deployment config", () => {
      let addedK8sDeploymentActions = Object.keys(loadedPlan.addedK8sDeploymentActions)
      let addedDockerDeployerActions = Object.keys(loadedPlan.addedDockerDeployerActions)

      expect(addedK8sDeploymentActions.join(", ")).to.contain("feature-xyz")
      expect(addedDockerDeployerActions.join(", ")).to.contain("testenvimage-migrations:0.0.0") // Referred migration image
    })
  })

  describe("k8s deployment plan", function() {
    let loadedPlan: TTestDeploymentOrchestration

    before(() => {
      process.env.CLUSTER_POLICY_MAX_CPU_REQUEST = "27m"
      process.env.GLOBAL_MIGRATION_ENV_VARIABLE_ONE = "anotherValue"
    })

    beforeEach(function() {
      createTestHerdLoader(labelsLoader, featureDeploymentConfig)
      return loader.loadHerd(__dirname + "/testdata/happypath/herd.yaml").then(function(plan) {
        loadedPlan = plan as TTestDeploymentOrchestration
      })
    })

    after(() => {
      delete process.env.CLUSTER_POLICY_MAX_CPU_REQUEST
      delete process.env.GLOBAL_MIGRATION_ENV_VARIABLE_ONE
    })

    it("should base64decode and untar deployment files under file path", function() {
      expect(loadedPlan.addedK8sDeploymentActions["Service_www-icelandair-com"].origin).to.equal(
        "testenvimage:0.0.0:tar:./deployment/www-icelandair-com.service.yml"
      )
    })

    it("should extract herdKey from herd.yaml", function() {
      expect(loadedPlan.addedK8sDeploymentActions["Service_www-icelandair-com"].herdKey).to.equal("test-image")
    })

    it("should include metadata for k8s plan", function() {
      let addedK8sDeployment = loadedPlan.addedK8sDeploymentActions["Service_www-icelandair-com"]
      expect(addedK8sDeployment.metadata).not.to.equal(undefined)

      expect(addedK8sDeployment.metadata.displayName).to.equal("Testimage")
      expect(addedK8sDeployment.herdDeclaration.key).to.equal("test-image", "key")
    })

    it("should apply k8s deployment-time cluster policy", function() {
      expect(loadedPlan.addedK8sDeploymentActions["Deployment_www-icelandair-com"].descriptor).to.contain("27m")
    })

    it("should be serializable", function() {
      let serializable = detectRecursion(loadedPlan)
      expect(serializable.join(".")).to.equal("")
      expect(serializable.length).to.equal(0)
    })
  })

  describe("deployer execution plan", function() {
    let loadedPlan: TTestDeploymentOrchestration

    beforeEach(function() {
      process.env.GLOBAL_MIGRATION_ENV_VARIABLE_ONE = "happyValueOne"
      return loader.loadHerd(__dirname + "/testdata/happypath/herd.yaml").then(function(plan) {
        loadedPlan = plan as TTestDeploymentOrchestration
      })
    })

    afterEach(() => {
      delete process.env.GLOBAL_MIGRATION_ENV_VARIABLE_ONE
    })

    it("should load deployer plan by migration image reference", function() {
      expect(loadedPlan.addedDockerDeployerActions["testenvimage-migrations:0.0.0"].dockerParameters).to.contain(
        "testenvimage-migrations:0.0.0"
      )
      expect(Object.keys(loadedPlan.addedDockerDeployerActions)).to.contain("testenvimage-migrations:0.0.0")
    })

    it("should use expanded docker parameter list as deployment descriptor for state checking", function() {
      expect(loadedPlan.addedDockerDeployerActions["testenvimage-migrations:0.0.0"].descriptor).to.equal(
        "-i --rm -e ENV=testenv -e EXPORT1=NotFromInfrastructureAnyMore -e DB_HOST=testing123 -e DB_PASS=testing123 -e THIS_IS_DEPLOYER_ONE=true testenvimage-migrations:0.0.0"
      )
    })
  })

  describe("non-existing image", function() {
    let loadError: Error

    // beforeEach(function() {
    //     originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    //     jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
    // });

    beforeEach(function() {
      return loader.loadHerd(__dirname + "/testdata/nonexistingimage/herd.yaml").catch(loadHerdError => {
        loadError = loadHerdError
      })
    })

    it("should fail with meaningful error message from image loader", function() {
      expect(loadError.message).to.contain("nonexistingimage:0.0.0")
    })
  })
})
