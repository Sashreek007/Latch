import { App } from "aws-cdk-lib";
import { DataStack } from "../lib/data-stack.ts";
import { GithubOidcStack } from "../lib/github-oidc-stack.ts";
import { NetworkStack } from "../lib/network-stack.ts";
import { ServicesStack } from "../lib/services-stack.ts";

const account = process.env.CDK_DEFAULT_ACCOUNT;
if (!account) {
  throw new Error(
    "CDK_DEFAULT_ACCOUNT is unset — run through the cdk CLI with AWS credentials configured.",
  );
}

const env = { account, region: "us-west-2" };

const app = new App();

new GithubOidcStack(app, "LatchGithubOidc", { env });

new NetworkStack(app, "LatchNetwork", { env });
new DataStack(app, "LatchData", { env });
new ServicesStack(app, "LatchServices", { env });
