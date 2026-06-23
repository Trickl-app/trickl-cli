# Trickl CLI

A setup tool that gets the Trickl observability pipeline deployed to your preferred environment. It pulls the required repos, wires everything together, and starts the stack — either locally via Docker or deployed to AWS.

---

## What it does

1. Clones the three Trickl repos into a directory of your choosing
2. Installs dependencies and builds the Grafana plugin
3. Either starts a local Docker stack **or** deploys the full cloud infrastructure to AWS

At the end you'll have Vector ready to receive OTLP metrics and Grafana ready to query them.

---

## Prerequisites

**For local deployment:**
- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) v18+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (must be running)

**For cloud deployment** (in addition to the above):
- [AWS CLI](https://aws.amazon.com/cli/) configured with valid credentials (`aws configure`)
- [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html) v2 (`npm install -g aws-cdk`)
- An ACM certificate already issued in your target AWS region
- A domain name you control (for DNS setup post-deploy)

---

## Getting started

```bash
npm install
node bin/trickl.js
```

The tool will walk you through the rest interactively.

---

## Local deployment

Starts a Docker Compose stack with:

| Service | Address |
|---------|---------|
| Vector (HTTP/OTLP) | `http://localhost:9090` |
| Vector (gRPC/OTLP) | `localhost:4317` |
| Grafana | `http://localhost:3000` — login: `admin / admin` |

You'll also be asked for an OpenAI API key (used by the smart metrics service) and, optionally, AWS S3 credentials for long-term metric storage. Either one of these can be omitted without crashing the system.

---

## Cloud deployment

Deploys the full stack to AWS via CDK. You'll need to provide:
- Your OpenAI API key
- A domain name and its ACM certificate ARN
- AWS region (auto-detected if you've run `aws configure`)

After deploy, the CLI prints the ALB DNS name for your CNAME record, your Vector endpoint and API key, and a Grafana URL protected by Cognito login. Creating your first Cognito user is a one-time manual step done through the AWS Console.

> Cloud deploy takes roughly 10–15 minutes on first run.

---

## Notes

- The repos are cloned as siblings inside whatever parent directory you choose; don't move them around after setup or relative paths will break
- Rerunning the CLI in the same parent directory will fail at the clone step if the repos already exist; just delete them first
