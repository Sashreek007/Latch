import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import {
  Effect,
  OpenIdConnectProvider,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
} from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

const GITHUB_REPOSITORY = "Sashreek007/Latch";

/**
 * Lets GitHub Actions obtain short-lived AWS credentials by proving which
 * repository and branch it is running from. No access key is ever created,
 * so there is none to leak or rotate.
 */
export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const provider = new OpenIdConnectProvider(this, "GithubProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    const deployRole = new Role(this, "DeployRole", {
      roleName: "latch-github-deploy",
      assumedBy: new WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": [
            `repo:${GITHUB_REPOSITORY}:ref:refs/heads/main`,
            `repo:${GITHUB_REPOSITORY}:pull_request`,
          ],
        },
      }),
    });

    // CDK deploys by assuming the roles that `cdk bootstrap` created, so this
    // role needs no direct access to any AWS service — only permission to
    // become the deployer.
    deployRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );

    new CfnOutput(this, "DeployRoleArn", { value: deployRole.roleArn });
  }
}
