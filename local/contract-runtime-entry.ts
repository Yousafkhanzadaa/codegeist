// Single-source portable exports. The bundle is generated for distribution;
// application and local verification use the same contract and numeric parser.
export { parseInputContract, canonicalInputContract, inputContractHash, validateContractPayload } from '../src/domain/input-contract';
export { parsePayload as parseContractPayload } from '../src/domain/json';
