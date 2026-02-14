import {
  ECSClient,
  RegisterTaskDefinitionCommand,
  CreateServiceCommand,
  UpdateServiceCommand,
  DescribeServicesCommand,
  ListTasksCommand,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";

const client = new ECSClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const PROJECT = process.env.PROJECT_NAME || "clawdbot";
const CLUSTER = process.env.ECS_CLUSTER_NAME || `${PROJECT}-cluster`;
const ECR_REPO = process.env.ECR_REPO_URI || "";
const TASK_EXECUTION_ROLE = process.env.ECS_TASK_EXECUTION_ROLE_ARN || "";
const TASK_ROLE = process.env.ECS_TASK_ROLE_ARN || "";
const SUBNETS = (process.env.VPC_SUBNET_IDS || "").split(",").filter(Boolean);
const SECURITY_GROUPS = (process.env.VPC_SECURITY_GROUP_IDS || "").split(",").filter(Boolean);
const LOG_GROUP = process.env.ECS_LOG_GROUP || `/ecs/${PROJECT}/tenant-runtime`;
const SHARED_SECRET = process.env.CONTROL_PLANE_SHARED_SECRET || "";

export interface ProvisionResult {
  taskDefArn: string;
  serviceName: string;
  cluster: string;
}

/**
 * Register a task definition for a tenant runtime.
 */
async function registerTaskDef(
  tenantId: string,
  secretArn: string
): Promise<string> {
  const family = `${PROJECT}-tenant-${tenantId}`;

  const res = await client.send(
    new RegisterTaskDefinitionCommand({
      family,
      requiresCompatibilities: ["FARGATE"],
      networkMode: "awsvpc",
      cpu: "256",
      memory: "512",
      executionRoleArn: TASK_EXECUTION_ROLE,
      taskRoleArn: TASK_ROLE,
      containerDefinitions: [
        {
          name: "tenant-runtime",
          image: `${ECR_REPO}:latest`,
          essential: true,
          portMappings: [
            {
              containerPort: 8080,
              protocol: "tcp",
            },
          ],
          environment: [
            { name: "TENANT_ID", value: tenantId },
            { name: "AWS_REGION", value: process.env.AWS_REGION || "us-east-1" },
            { name: "SECRETS_ID", value: secretArn },
            { name: "CONTROL_PLANE_SHARED_SECRET", value: SHARED_SECRET },
            { name: "PORT", value: "8080" },
          ],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": LOG_GROUP,
              "awslogs-region": process.env.AWS_REGION || "us-east-1",
              "awslogs-stream-prefix": `tenant-${tenantId}`,
            },
          },
          healthCheck: {
            command: [
              "CMD-SHELL",
              "node -e \"fetch('http://localhost:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))\"",
            ],
            interval: 30,
            timeout: 5,
            retries: 3,
            startPeriod: 60,
          },
        },
      ],
    })
  );

  return res.taskDefinition!.taskDefinitionArn!;
}

/**
 * Create or update an ECS service for a tenant.
 */
export async function provisionTenantEcsService(
  tenantId: string,
  secretArn: string
): Promise<ProvisionResult> {
  const serviceName = `${PROJECT}-tenant-${tenantId}`;

  // Register new task definition
  const taskDefArn = await registerTaskDef(tenantId, secretArn);

  // Check if service already exists
  try {
    const desc = await client.send(
      new DescribeServicesCommand({
        cluster: CLUSTER,
        services: [serviceName],
      })
    );

    const existing = desc.services?.find(
      (s) => s.serviceName === serviceName && s.status !== "INACTIVE"
    );

    if (existing) {
      // Update existing service
      await client.send(
        new UpdateServiceCommand({
          cluster: CLUSTER,
          service: serviceName,
          taskDefinition: taskDefArn,
          desiredCount: 1,
          forceNewDeployment: true,
        })
      );
      console.log(`[ecs] Updated service ${serviceName}`);
    } else {
      throw new Error("not found");
    }
  } catch {
    // Create new service
    await client.send(
      new CreateServiceCommand({
        cluster: CLUSTER,
        serviceName,
        taskDefinition: taskDefArn,
        desiredCount: 1,
        launchType: "FARGATE",
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: SUBNETS,
            securityGroups: SECURITY_GROUPS,
            assignPublicIp: "ENABLED",
          },
        },
      })
    );
    console.log(`[ecs] Created service ${serviceName}`);
  }

  return {
    taskDefArn,
    serviceName,
    cluster: CLUSTER,
  };
}

export interface RuntimeStatus {
  serviceName: string;
  status: string;
  runningCount: number;
  desiredCount: number;
  taskIp: string | null;
}

/**
 * Get the current status of a tenant's ECS service.
 */
export async function getTenantRuntimeStatus(
  tenantId: string
): Promise<RuntimeStatus | null> {
  const serviceName = `${PROJECT}-tenant-${tenantId}`;

  try {
    const desc = await client.send(
      new DescribeServicesCommand({
        cluster: CLUSTER,
        services: [serviceName],
      })
    );

    const svc = desc.services?.[0];
    if (!svc || svc.status === "INACTIVE") return null;

    // Get running task IP
    let taskIp: string | null = null;
    try {
      const tasks = await client.send(
        new ListTasksCommand({
          cluster: CLUSTER,
          serviceName,
          desiredStatus: "RUNNING",
        })
      );

      if (tasks.taskArns && tasks.taskArns.length > 0) {
        const taskDetails = await client.send(
          new DescribeTasksCommand({
            cluster: CLUSTER,
            tasks: [tasks.taskArns[0]],
          })
        );

        const eni =
          taskDetails.tasks?.[0]?.attachments?.[0]?.details?.find(
            (d) => d.name === "networkInterfaceId"
          );
        const ip =
          taskDetails.tasks?.[0]?.attachments?.[0]?.details?.find(
            (d) => d.name === "privateIPv4Address"
          );
        // For public IP, we'd need to describe the ENI
        // For simplicity, use the task's container network interface
        const containers = taskDetails.tasks?.[0]?.containers;
        if (containers && containers[0]?.networkInterfaces?.[0]?.privateIpv4Address) {
          taskIp = containers[0].networkInterfaces[0].privateIpv4Address;
        }
      }
    } catch {
      // Couldn't get task IP, that's ok
    }

    return {
      serviceName,
      status: svc.status || "UNKNOWN",
      runningCount: svc.runningCount || 0,
      desiredCount: svc.desiredCount || 0,
      taskIp,
    };
  } catch {
    return null;
  }
}
