// Public schemas only. These constants contain no source scalar values.
export const hermesInputContract = {
  version: 1,
  schema: { type: 'object', additionalProperties: false, required: ['calls'], properties: {
    calls: { type: 'array', minItems: 2, maxItems: 32, items: { type: 'object', additionalProperties: false, required: ['chat_id'], properties: {
      chat_id: { type: 'string', format: 'integer-string', minLength: 16, maxLength: 19, minimum: '1000000000000000', maximum: '9223372036854775807' },
    } } },
  } },
};
export const deburrInputContract = {
  version: 1,
  schema: { type: 'object', additionalProperties: false, required: ['text'], properties: {
    text: { type: 'string', minLength: 1, maxLength: 256 },
  } },
};
