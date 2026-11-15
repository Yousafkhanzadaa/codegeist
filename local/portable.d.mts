export function buildPortableRunner(options: {
  profile: unknown;
  cwd: string;
  fixtureJson: string;
  reviewedCode: boolean;
  privateSourceJson?: string;
}): Promise<{ runner: string; runnerHash: string; testSpecHash: string; declaredFiles: string[]; disclosures: string[] }>;
