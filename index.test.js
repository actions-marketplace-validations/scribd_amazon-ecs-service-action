const _ = require('lodash');
const i = require('./index');

jest.mock('@actions/core');
const core = require('@actions/core');

jest.mock('@aws-sdk/client-ecs');
const {ECSClient, UpdateServiceCommand, DeleteServiceCommand} = require('@aws-sdk/client-ecs');
const {waitUntilServicesInactive, waitUntilTasksRunning} = require('@aws-sdk/client-ecs');

/**
 *
 * PARAMETER DEFINITIONS
 *
 *****************************************************************************************/

const mockSpec = {
  // capacityProviderStrategy: undefined,
  // clientToken: undefined,
  cluster: 'my-cluster',
  deploymentConfiguration: {
    deploymentCircuitBreaker: {
      enable: true,
      rollback: false,
    },
    maximumPercent: 200,
    minimumHealthyPercent: 32,
  },
  deploymentController: 'ECS',
  desiredCount: 2,
  enableECSManagedTags: true,
  // enableExecuteCommand: undefined,
  // healthCheckGracePeriodSeconds: undefined,
  launchType: 'EC2',
  loadBalancers: [],
  networkConfiguration: {
    awsvpcConfiguration: {
      subnets: ['subnet-abc123', 'subnet-def567'],
      securityGroups: ['sg-abc123', 'sg-def567'],
      assignPublicIp: 'DISABLED',
    },
  },
  placementConstraints: [],
  placementStrategy: [],
  // platformVersion: undefined,
  // propagateTags: undefined,
  // role: undefined,
  schedulingStrategy: 'REPLICA',
  serviceName: 'my-service',
  serviceRegistries: [
    {
      registryArn: 'arn:aws:servicediscovery:us-east-1:1234567890:service/srv-my-service:',
      port: 8080,
    },
  ],
  tags: [{key: 'my-key', value: 'my-value'}],
  taskDefinition: 'task-definition-family:123',
};

const parameters = {
  spec: mockSpec,
  action: 'create',
  // forceNewDeployment: undefined,
  // forceDelete: undefined,
  // waitUntilTasksRunning: undefined,
};

const createInput = mockSpec;

// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-ecs/interfaces/describeservicescommandinput.html
const describeInput = {
  cluster: mockSpec.cluster,
  include: ['TAGS'],
  services: [mockSpec.serviceName],
};

// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-ecs/interfaces/updateservicecommandinput.html
const updateInput = i.omitUndefined({
  capacityProviderStrategy: mockSpec.capacityProviderStrategy,
  cluster: mockSpec.cluster,
  deploymentConfiguration: mockSpec.deploymentConfiguration,
  desiredCount: mockSpec.desiredCount,
  enableExecuteCommand: mockSpec.enableExecuteCommand,
  forceNewDeployment: parameters.forceNewDeployment, // This is new
  networkConfiguration: mockSpec.networkConfiguration,
  placementConstraints: mockSpec.placementConstraints,
  placementStrategy: mockSpec.placementStrategy,
  platformVersion: mockSpec.platformVersion,
  service: mockSpec.serviceName, // This is a different keyword
  taskDefinition: mockSpec.taskDefinition,
});

const deleteInput = i.omitUndefined({
  cluster: mockSpec.cluster,
  service: mockSpec.serviceName, // This is a different keyword
  forceDelete: parameters.forceDelete,
});


/**
 *
 * MOCKED RESPONSES
 *
 *****************************************************************************************/

// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-ecs/modules/service.html
const createdOrFoundService = i.omitUndefined(
    {
      ...mockSpec,
      clientToken: undefined, // remove this keyword
      cluster: undefined, // remove this keyword
      clusterArn: 'arn:aws:ecs:us-east-1:1234567890:cluster/my-cluster',
      createdAt: new Date(),
      createdBy: 'arn:aws:iam:us-east-1:1234567890:role/my-role',
      deployments: [],
      events: [],
      pendingCount: 0,
      role: undefined, // remove this keyword
      roleArn: 'arn:aws:iam:us-east-1:1234567890:role/someother-role',
      runningCount: 2,
      serviceArn: 'arn:aws:ecs:us-east-1:1234567890:service/my-service',
      status: 'ACTIVE', // INACTIVE, or DRAINING
      taskSets: [],
    },
);
const inactiveService = {...createdOrFoundService, status: 'INACTIVE'};
const serviceThatNeedsUpdating = {...createdOrFoundService, desiredCount: 1};

const describeServicesCommandOutputMissing = {
  $metadata: {
    httpStatusCode: 404,
  },
  failures: [{
    arn: 'arn:aws:ecs:us-east-1:1234567890:service/my-service',
    detail: 'Service not found',
    reason: 'MISSING',
  }],
  services: [],
};

const describeServicesCommandOutputNeedsUpdating = {
  $metadata: {
    httpStatusCode: 200,
  },
  failures: [],
  services: [serviceThatNeedsUpdating],
};


const describeServicesCommandOutputFound = {
  $metadata: {
    httpStatusCode: 200,
  },
  failures: [],
  services: [createdOrFoundService],
};

const describeServicesCommandOutputInactive = {
  $metadata: {
    httpStatusCode: 200,
  },
  failures: [],
  services: [inactiveService],
};

const createServiceCommandOutput = {
  $metadata: {

    httpStatusCode: 201,
  },
  service: createdOrFoundService,
};

const genericFailureResponse = {
  $metadata: {
    httpStatusCode: 500,
  },
  failures: [{
    arn: 'arn:aws:ecs:us-east-1:1234567890:service/my-service',
    detail: 'Generic Failure for testing purposes only',
    reason: 'GENERIC',
  }],
  services: [],
};


/**
 *
 * PARAMETER CONVERSION
 * Converts the supplied (create) parameters into the formats for describe, update, and delete.
 *
 *****************************************************************************************/

describe('PARAMETER CONVERSION', () => {
  describe('createInput', () => {
    test('only returns valid elements', () => {
      expect(i.createInput(parameters)).toStrictEqual(createInput);
    });
  });

  describe('describeInput', () => {
    test('only returns valid elements', () => {
      expect(i.describeInput(parameters)).toStrictEqual(describeInput);
    });
  });

  describe('updateInput', () => {
    test('only returns valid elements', () => {
      expect(i.updateInput(parameters)).toStrictEqual(updateInput);
    });
  });

  describe('deleteInput', () => {
    test('only returns valid elements', () => {
      expect(i.deleteInput(parameters)).toStrictEqual(deleteInput);
    });
    test('only returns valid elements', () => {
      expect(i.deleteInput({spec: {serviceName: 's', cluster: 'c'}, forceDelete: true})).toStrictEqual({service: 's', cluster: 'c', force: true});
    });
  });
});


/**
 *
 * DELETE
 *
 *****************************************************************************************/
describe('DELETE', () => {
  describe('deleteService', () => {
    beforeEach(() => {
      waitUntilServicesInactive.mockResolvedValue({state: 'SUCCESS'});
      ECSClient.send = jest.fn().mockResolvedValue(describeServicesCommandOutputFound);
      UpdateServiceCommand.mockClear();
    });

    test('just deletes right away when forceDelete is true', async () => {
      await expect(i.deleteService(ECSClient, {spec: {cluster: 'my-cluster', serviceName: 'my-service'}, forceDelete: true})).resolves.toEqual(createdOrFoundService);
      expect(UpdateServiceCommand).not.toHaveBeenCalled();
    });

    test('first scales down to 0 when forceDelete is false', async () => {
      const result = await i.deleteService(ECSClient, {spec: {cluster: 'my-cluster', serviceName: 'my-service'}, forceDelete: false});
      expect(UpdateServiceCommand).toHaveBeenCalledWith({
        cluster: 'my-cluster',
        service: 'my-service',
        desiredCount: 0,
      });
      expect(result).toEqual(createdOrFoundService);
    });

    test('deletes the Service when one exists and it is active', async () => {
      ECSClient.send = jest.fn().mockResolvedValue(describeServicesCommandOutputFound);
      await expect(i.deleteService(ECSClient, parameters)).resolves.toEqual(createdOrFoundService);
      expect(DeleteServiceCommand).toHaveBeenCalledWith(deleteInput);
    });

    test('throws NotFoundException when one exists and it is inactive', async () => {
      ECSClient.send = jest.fn().mockResolvedValue(describeServicesCommandOutputInactive);
      await expect(i.deleteService(ECSClient, parameters)).rejects.toThrow(i.NotFoundException);
    });

    test('throws an error when a generic error occurs', async () => {
      ECSClient.send = jest.fn()
          .mockResolvedValueOnce(genericFailureResponse) // updateServiceCommand
          .mockResolvedValueOnce(genericFailureResponse); // DeleteServiceCommand
      await expect(i.deleteService(ECSClient, parameters)).rejects.toThrow(Error);
    });
  });
});


/**
 *
 * UPDATE
 *
 *****************************************************************************************/

describe('UPDATE', () => {
  const neededUpdate = {
    desiredCount: 2,
    service: 'my-service',
    cluster: 'my-cluster',
  };

  describe('whatsTheDiff', () => {
    test('returns the diff between two hashes', () => {
      expect(i.whatsTheDiff({desiredCount: 1}, {spec: {desiredCount: 2}})).toStrictEqual({desiredCount: 2});
    });
    test('service that needs updating', () => {
      expect(i.whatsTheDiff(serviceThatNeedsUpdating, parameters)).toStrictEqual(neededUpdate);
    });
    test('when the forceNewDeployment is set', () => {
      expect(i.whatsTheDiff(createdOrFoundService, {...parameters, forceNewDeployment: true})).toStrictEqual({cluster: 'my-cluster', service: 'my-service', forceNewDeployment: true});
    });
  });

  describe('updateNeeded', () => {
    test('returns what needs updating when the service needs updating', () => {
      expect(i.updateNeeded(serviceThatNeedsUpdating, parameters)).toStrictEqual([true, neededUpdate]);
    });

    test('returns everything when given an empty parameters', () => {
      expect(i.updateNeeded({}, parameters)).toStrictEqual([true, updateInput]);
    });

    test('returns false when the service does not need updating', () => {
      expect(i.updateNeeded(createdOrFoundService, parameters )).toStrictEqual([false, {cluster: 'my-cluster', service: 'my-service'}]);
    });

    test('returns true when the forceNewDeployment is set', () => {
      expect(i.updateNeeded(createdOrFoundService, {...parameters, forceNewDeployment: true})).toStrictEqual([true, {cluster: 'my-cluster', service: 'my-service', forceNewDeployment: true}]);
    });
  });

  // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-ecs/classes/updateservicecommand.html
  describe('isUpdateShapeValid', () => {
    const everyChange = {
      desiredCount: 2,
      cluster: 'my-cluster',
      placementConstraints: [],
      placementStrategy: [],
      service: 'my-service',
      forceNewDeployment: false,
    };

    const testCases = (currentService, validChanges, invalidChanges) => {
      test('returns update parameters when only valid parameters are changed', () => {
        expect(i.isUpdateShapeValid(currentService, validChanges)).toEqual([true, []]);
      });

      test('false when additional parameters are changed', () => {
        expect(i.isUpdateShapeValid(currentService, invalidChanges)[0]).toEqual(false);
      });
    };

    describe('when deployment controller is ECS', () => {
      const currentService = createdOrFoundService;
      const validChanges = {
        ...everyChange,
        deploymentConfiguration: {},
        networkConfiguration: {},
        taskDefinition: 'task-definition-family:123',
      };

      const invalidChanges = {
        ...validChanges,
        healthCheckGracePeriodSeconds: 30,
      };

      testCases(currentService, validChanges, invalidChanges);
    });
    describe('when deployment controller is CODE_DEPLOY', () => {
      const currentService = {...createdOrFoundService, deploymentController: 'CODE_DEPLOY'};
      const validChanges = {
        ...everyChange,
        deploymentConfiguration: {},
        healthCheckGracePeriodSeconds: 30,
      };

      const invalidChanges = {
        ...validChanges,
        taskDefinition: 'task-definition-family:123',
      };

      testCases(currentService, validChanges, invalidChanges);
    });

    describe('when deployment controller is EXTERNAL', () => {
      const currentService = {...createdOrFoundService, deploymentController: 'EXTERNAL'};
      const validChanges = {
        ...everyChange,
        healthCheckGracePeriodSeconds: 30,
      };

      const invalidChanges = {
        ...validChanges,
        taskDefinition: 'task-definition-family:123',
      };

      testCases(currentService, validChanges, invalidChanges);
    });
  });

  describe('updateService', () => {
    test('returns the Service when it is updated successfully', async () => {
      ECSClient.send = jest.fn().mockResolvedValue(createServiceCommandOutput); // Same output
      await expect(i.updateService(ECSClient, parameters)).resolves.toEqual(createdOrFoundService);
    });

    describe('waitUntilTasksRunning', () => {
      describe('waits when defined', () => {
        beforeEach(() => {
          waitUntilTasksRunning.mockResolvedValue({state: 'SUCCESS'});
          waitUntilTasksRunning.mockClear();
        });
        test('calls waitUntilTasksRunning when wait-until-tasks-running is true', async () => {
          ECSClient.send = jest.fn().mockResolvedValue(createServiceCommandOutput);
          await i.updateService(ECSClient, {...parameters, waitUntilTasksRunning: true});
          expect(waitUntilTasksRunning).toHaveBeenCalled();
        });
        test('does not call waitUntilTasksRunning when wait-until-tasks-running is false', async () => {
          ECSClient.send = jest.fn().mockResolvedValue(createServiceCommandOutput);
          await i.updateService(ECSClient, {...parameters, waitUntilTasksRunning: false});
          expect(waitUntilTasksRunning).not.toHaveBeenCalled();
        });
        test('does not call waitUntilTasksRunning when wait-until-tasks-running is undefined', async () => {
          ECSClient.send = jest.fn().mockResolvedValue(createServiceCommandOutput);
          await i.updateService(ECSClient, parameters);
          expect(waitUntilTasksRunning).not.toHaveBeenCalled();
        });
      });
    });

    test('throws an error when a generic error occurs', async () => {
      ECSClient.send = jest.fn().mockRejectedValue(genericFailureResponse);
      await expect(i.updateService(ECSClient, parameters)).rejects.toEqual(genericFailureResponse);
    });
  });
});


/**
 *
 * FIND
 *
 *****************************************************************************************/

describe('FIND', () => {
  describe('findServiceInResponse', () => {
    describe('when a DescribeServicesCommandOutput', () => {
      describe('and it exists', () => {
        test('returns the service', async () => {
          expect(i.findServiceInResponse({services: [{serviceName: 'my-service', status: 'ACTIVE'}]}, 'my-service')).toEqual({serviceName: 'my-service', status: 'ACTIVE'});
        });
      });
      describe('and it does not exist', () => {
        test('throws NotFoundException', async () => {
          expect(() => {
            i.findServiceInResponse({services: [{serviceName: 'not-my-service', status: 'ACTIVE'}]}, 'my-service');
          }).toThrow(i.NotFoundException);
        });
      });
      describe('and it is INACTIVE', () => {
        test('throws NotFoundException', async () => {
          expect(() => {
            i.findServiceInResponse({services: [{serviceName: 'my-service', status: 'INACTIVE'}]}, 'my-service');
          }).toThrow(i.NotFoundException);
        });
      });
      describe('and it is DRAINING', () => {
        test('throws Draining', async () => {
          expect(() => {
            i.findServiceInResponse({services: [{serviceName: 'my-service', status: 'DRAINING'}]}, 'my-service');
          }).toThrow(i.Draining);
        });
      });
    });
    describe('when a Create or Update or Delete', () => {
      describe('and it exists', () => {
        test('returns the service', async () => {
          expect(i.findServiceInResponse({service: {serviceName: 'my-service', status: 'ACTIVE'}}, 'my-service')).toEqual({serviceName: 'my-service', status: 'ACTIVE'});
        });
      });
      describe('and it is INACTIVE', () => {
        test('throws NotFoundException', async () => {
          expect(() => {
            i.findServiceInResponse({service: {serviceName: 'my-service', status: 'INACTIVE'}}, 'my-service');
          }).toThrow(i.NotFoundException);
        });
      });
      describe('and it is DRAINING', () => {
        test('throws Draining', async () => {
          expect(() => {
            i.findServiceInResponse({service: {serviceName: 'my-service', status: 'DRAINING'}}, 'my-service');
          }).toThrow(i.Draining);
        });
      });
    });
    describe('error handling', () => {
      test('has failures', async () => {
        expect(() => {
          i.findServiceInResponse({failures: [1]}, 'my-service');
        }).toThrow(Error);
      });
      test('undefined', async () => {
        expect(() => {
          i.findServiceInResponse(undefined, 'my-service');
        }).toThrow(Error);
      });
      test('empty', async () => {
        expect(() => {
          i.findServiceInResponse({}, 'my-service');
        }).toThrow(Error);
      });
      test('unexpected status', async () => {
        expect(() => {
          i.findServiceInResponse({service: {status: 'banana'}}, 'my-service');
        }).toThrow(Error);
      });
      test('generic failure', async () => {
        expect(() => {
          i.findServiceInResponse(genericFailureResponse, 'my-service');
        }).toThrow(Error);
      });
    });
  });

  describe('describeService', () => {
    test('returns the Service when one exists and it is active', async () => {
      ECSClient.send = jest.fn().mockResolvedValue(describeServicesCommandOutputFound);
      await expect(i.describeService(ECSClient, parameters)).resolves.toEqual(createdOrFoundService);
    });
    test('throws NotFoundException when none exists already', async () => {
      ECSClient.send = jest.fn().mockResolvedValue(describeServicesCommandOutputMissing);
      await expect(i.describeService(ECSClient, parameters)).rejects.toThrow(i.NotFoundException);
    });
    test('throws an error when a generic error occurs', async () => {
      ECSClient.send = jest.fn().mockRejectedValue(genericFailureResponse);
      await expect(i.describeService(ECSClient, parameters)).rejects.toEqual(genericFailureResponse);
    });
  });
});


/**
 *
 * CREATE
 *
 *****************************************************************************************/

describe('CREATE', () => {
  describe('createService', () => {
    test('returns the Service when it is created successfully', async () => {
      ECSClient.send = jest.fn().mockResolvedValue(createServiceCommandOutput);
      await expect(i.createService(ECSClient, parameters)).resolves.toEqual(createdOrFoundService);
    });


    describe('waitUntilTasksRunning', () => {
      describe('waits when defined', () => {
        beforeEach(() => {
          waitUntilTasksRunning.mockResolvedValue({state: 'SUCCESS'});
          waitUntilTasksRunning.mockClear();
        });
        test('calls waitUntilTasksRunning when wait-until-tasks-running is true', async () => {
          ECSClient.send = jest.fn().mockResolvedValue(createServiceCommandOutput);
          await i.createService(ECSClient, {...parameters, waitUntilTasksRunning: true});
          expect(waitUntilTasksRunning).toHaveBeenCalled();
        });
        test('does not call waitUntilTasksRunning when wait-until-tasks-running is false', async () => {
          ECSClient.send = jest.fn().mockResolvedValue(createServiceCommandOutput);
          await i.createService(ECSClient, {...parameters, waitUntilTasksRunning: false});
          expect(waitUntilTasksRunning).not.toHaveBeenCalled();
        });
        test('does not call waitUntilTasksRunning when wait-until-tasks-running is undefined', async () => {
          ECSClient.send = jest.fn().mockResolvedValue(createServiceCommandOutput);
          await i.createService(ECSClient, parameters);
          expect(waitUntilTasksRunning).not.toHaveBeenCalled();
        });
      });
    });

    test('throws an error when a generic error occurs', async () => {
      ECSClient.send = jest.fn().mockRejectedValue(genericFailureResponse);
      await expect(i.createService(ECSClient, parameters)).rejects.toEqual(genericFailureResponse);
    });
  });
});


/**
 *
 * FIND / CREATE / UPDATE (Logic)
 *
 *****************************************************************************************/

describe('FIND / CREATE / UPDATE (Logic)', () => {
  describe('findOrCreateService', () => {
    test('creates the Service when none exists already', async () => {
      ECSClient.send = jest.fn()
          .mockResolvedValueOnce(describeServicesCommandOutputMissing)
          .mockResolvedValue(createServiceCommandOutput);
      await expect(i.findOrCreateService(ECSClient, parameters)).resolves.toEqual(createdOrFoundService);
    });

    test('returns the Service when one exists and it is active', async () => {
      ECSClient.send = jest.fn().mockResolvedValue(describeServicesCommandOutputFound);
      await expect(i.findOrCreateService(ECSClient, parameters)).resolves.toEqual(createdOrFoundService);
    });

    test('creates the Service when one exists and it is inactive', async () => {
      ECSClient.send = jest.fn()
          .mockResolvedValueOnce(describeServicesCommandOutputInactive)
          .mockResolvedValueOnce(createServiceCommandOutput);
      await expect(i.findOrCreateService(ECSClient, parameters)).resolves.toEqual(createdOrFoundService);
    });

    test('updates the Service when one exists and it needs updating', async () => {
      ECSClient.send = jest.fn()
          .mockResolvedValueOnce(describeServicesCommandOutputNeedsUpdating)
          .mockResolvedValueOnce(createServiceCommandOutput);
      await expect(i.findOrCreateService(ECSClient, parameters)).resolves.toEqual(createdOrFoundService);
    });

    test('throws an error when a generic error occurs', async () => {
      ECSClient.send = jest.fn().mockResolvedValueOnce(genericFailureResponse); // CreateServiceCommand
      await expect(i.findOrCreateService(ECSClient, parameters)).rejects.toThrow(Error);
    });
  });
});


/**
 *
 * GITHUB ACTIONS INTERFACE
 * - Gets parameters from the user.
 * - Posts results as output.
 *
 *****************************************************************************************/

describe('GITHUB ACTIONS INTERFACE', () => {
  describe('getParameters', () => {
    describe('when spec-file is supplied', () => {
      test('it gets the parameters', () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('examples/service-spec.json'); // this file contains filteredParameters as JSON.

        expect(i.getParameters()).toStrictEqual(parameters);
      });
    });

    describe('when bad path to spec-file is supplied', () => {
      test('it gets the parameters', () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('examples/nothing-here'); // this file contains filteredParameters as JSON.

        expect(() => i.getParameters()).toThrow('Unable to open spec-file: ENOENT: no such file or directory, open \'examples/nothing-here\'');
      });
    });

    describe('when spec is supplied', () => {
      test('it gets the parameters', () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce(JSON.stringify(mockSpec));

        expect(i.getParameters()).toStrictEqual(parameters);
      });
    });


    describe('when forceDelete is supplied', () => {
      test('it gets the parameters', () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('delete')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('true')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce(JSON.stringify(mockSpec));

        expect(i.getParameters()).toStrictEqual({action: 'delete', forceDelete: 'true', spec: mockSpec});
      });
    });

    describe('when neither spec-file nor spec is supplied', () => {
      test('it throws an error', () => {
        expect(() => i.getParameters()).toThrow('');
      });
    });

    describe('when there is a typo in the spec', () => {
      test('it throws an error', () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('')
            .mockReturnValueOnce('{'); // second call is to get the service spec

        expect(() => i.getParameters()).toThrow('Invalid JSON for spec: Unexpected end of JSON input: {');
      });
    });
  });


  describe('postToGithub', () => {
    test('sets response and arn when created or found', () => {
      i.postToGithub(createdOrFoundService);
      expect(core.setOutput).toHaveBeenNthCalledWith(1, 'service', JSON.stringify(createdOrFoundService));
      expect(core.setOutput).toHaveBeenNthCalledWith(2, 'arn', 'arn:aws:ecs:us-east-1:1234567890:service/my-service');
    });
  });
});
