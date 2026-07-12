import { dirname } from "node:path";
import { parseArgs } from "node:util";

import { buildProductCatalogArtifact } from "../catalog/product-catalog-artifact";
import { createPromotionReleaseObjectStore } from "../../src/release/release-object-storage";
import { ReleasePublisher } from "../../src/release/release-publication";
import {
  SourceRefreshOrchestrator,
  type SourceRefreshEvent,
} from "../../src/release/source-refresh";
import { SourceStatusPublisher } from "../../src/release/source-status-publication";
import { buildAnalysisArtifact } from "./analysis-artifact";
import { stageBaciRelease } from "./baci-source-staging";
import {
  requiredOption,
  writeReleaseCommandError,
} from "./release-command";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "baci-release": { type: "string" },
      descriptor: { type: "string" },
      approval: { type: "string" },
      archive: { type: "string" },
      "staging-workspace": { type: "string" },
      "staging-report": { type: "string" },
      "analysis-workspace": { type: "string" },
      "analysis-report": { type: "string" },
      "catalog-workspace": { type: "string" },
      "catalog-report": { type: "string" },
      translations: { type: "string" },
      aliases: { type: "string" },
      "traditional-to-simplified": { type: "string" },
      "review-manifest": { type: "string" },
      "pipeline-git-sha": { type: "string" },
      "built-at": { type: "string" },
      "activated-at": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const baciRelease = requiredOption(
    values["baci-release"],
    "baci-release",
  );
  const builtAt = requiredOption(values["built-at"], "built-at");
  const activatedAt = requiredOption(
    values["activated-at"],
    "activated-at",
  );
  const objectStore = createPromotionReleaseObjectStore();
  const orchestrator = new SourceRefreshOrchestrator({
    deployments: new ReleasePublisher(objectStore),
    statuses: new SourceStatusPublisher(objectStore),
    observe: writePrivateRefreshDiagnostic,
    async build({ baciRelease: requestedRelease, signal }) {
      if (requestedRelease !== baciRelease) {
        throw new Error("Refresh build target changed unexpectedly.");
      }
      signal?.throwIfAborted();
      const staging = await stageBaciRelease({
        descriptorPath: requiredOption(
          values.descriptor,
          "descriptor",
        ),
        approvalPath: requiredOption(
          values.approval,
          "approval",
        ),
        archivePath: values.archive,
        workspacePath: requiredOption(
          values["staging-workspace"],
          "staging-workspace",
        ),
        reportPath: requiredOption(
          values["staging-report"],
          "staging-report",
        ),
      });
      signal?.throwIfAborted();
      const pipelineGitSha = requiredOption(
        values["pipeline-git-sha"],
        "pipeline-git-sha",
      );
      const [analysis, catalog] = await Promise.all([
        buildAnalysisArtifact({
          stagingManifestPath: staging.stagingManifestPath,
          workspacePath: requiredOption(
            values["analysis-workspace"],
            "analysis-workspace",
          ),
          reportPath: requiredOption(
            values["analysis-report"],
            "analysis-report",
          ),
          pipelineGitSha,
          builtAt,
        }),
        buildProductCatalogArtifact({
          stagingManifestPath: staging.stagingManifestPath,
          translationsPath: requiredOption(
            values.translations,
            "translations",
          ),
          aliasesPath: requiredOption(values.aliases, "aliases"),
          traditionalToSimplifiedPath: requiredOption(
            values["traditional-to-simplified"],
            "traditional-to-simplified",
          ),
          reviewManifestPath: requiredOption(
            values["review-manifest"],
            "review-manifest",
          ),
          workspacePath: requiredOption(
            values["catalog-workspace"],
            "catalog-workspace",
          ),
          reportPath: requiredOption(
            values["catalog-report"],
            "catalog-report",
          ),
          pipelineGitSha,
          builtAt,
        }),
      ]);
      signal?.throwIfAborted();
      return {
        analysisDirectoryPath: dirname(analysis.artifactPath),
        productCatalogDirectoryPath: dirname(catalog.catalogPath),
      };
    },
  });
  const result = await orchestrator.refresh({
    baciRelease,
    activatedAt,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main().catch((error: unknown) => {
  writeReleaseCommandError("BACI release refresh", error);
});

function writePrivateRefreshDiagnostic(
  event: SourceRefreshEvent,
): void {
  process.stderr.write(
    `${JSON.stringify({
      ...event,
      error:
        "error" in event
          ? privateDiagnostic(event.error)
          : undefined,
    })}\n`,
  );
}

function privateDiagnostic(error: unknown): {
  name: string;
  message: string;
} {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError", message: String(error) };
}
