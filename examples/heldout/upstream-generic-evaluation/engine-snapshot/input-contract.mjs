// Generated from src/domain/input-contract.ts. Regenerate: node local/build-contract-runtime.mjs
import { createHash } from "node:crypto";
// src/domain/json.ts
const INPUT_LIMITS = {
	bytes: 65536,
	depth: 20,
	nodes: 2e3
};
function sha256(value) {
	return createHash("sha256").update(value, "utf8").digest("hex");
}
var PayloadError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "PayloadError";
	}
};
function decimalForm(token) {
	const negative = token.startsWith("-");
	const [mantissa, exponentText = "0"] = token.replace(/^-/, "").toLowerCase().split("e");
	const fractionLength = mantissa.includes(".") ? mantissa.length - mantissa.indexOf(".") - 1 : 0;
	let digits = mantissa.replace(".", "").replace(/^0+/, "");
	if (!digits) return "0";
	let exponent = Number(exponentText) - fractionLength;
	while (digits.endsWith("0")) {
		digits = digits.slice(0, -1);
		exponent += 1;
	}
	return `${negative ? "-" : ""}${digits}e${exponent}`;
}
function readNumber(token) {
	if (token.length > 128) throw new PayloadError("A numeric literal is too long. Encode identifiers as JSON strings.");
	const value = Number(token);
	if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new PayloadError("An unsafe numeric literal was found. Encode long identifiers as JSON strings before scanning.");
	if (decimalForm(token) !== decimalForm(String(value))) throw new PayloadError("A numeric literal would lose precision. Encode the exact value as a JSON string.");
	return value;
}
/** Strict JSON parsing with bounds enforced while reading, not after allocation. */
function parsePayload(source) {
	if (typeof source !== "string") throw new PayloadError("Supply a JSON string.");
	if (Buffer.byteLength(source, "utf8") > INPUT_LIMITS.bytes) throw new PayloadError("JSON must be at most 64 KiB.");
	if (!source.trim()) throw new PayloadError("Paste a non-empty JSON payload.");
	let position = 0;
	let nodes = 0;
	const whitespace = () => {
		while (/[\t\n\r ]/.test(source[position] ?? "\0")) position += 1;
	};
	const fail = () => {
		throw new PayloadError(`Invalid JSON near character ${position + 1}.`);
	};
	function string() {
		const start = position;
		if (source[position++] !== "\"") return fail();
		while (position < source.length) {
			const character = source[position++];
			if (character === "\"") return JSON.parse(source.slice(start, position));
			if (character.charCodeAt(0) < 32) return fail();
			if (character === "\\") {
				const escape = source[position++];
				if (escape === "u") {
					if (!/^[0-9a-fA-F]{4}$/.test(source.slice(position, position + 4))) return fail();
					position += 4;
				} else if (!escape || !"\"\\/bfnrt".includes(escape)) return fail();
			}
		}
		return fail();
	}
	function value(depth) {
		whitespace();
		if (depth > INPUT_LIMITS.depth) throw new PayloadError("JSON nesting must be at most 20 levels.");
		nodes += 1;
		if (nodes > INPUT_LIMITS.nodes) throw new PayloadError("JSON must contain at most 2,000 values.");
		const character = source[position];
		if (character === "\"") return string();
		if (character === "{") {
			position += 1;
			whitespace();
			const result = Object.create(null);
			const keys = /* @__PURE__ */ new Set();
			if (source[position] === "}") {
				position += 1;
				return result;
			}
			while (position < source.length) {
				whitespace();
				if (source[position] !== "\"") return fail();
				const key = string();
				if ([
					"__proto__",
					"prototype",
					"constructor"
				].includes(key)) throw new PayloadError("Prototype-related object keys are not supported.");
				if (keys.has(key)) throw new PayloadError("Duplicate object keys are not supported.");
				keys.add(key);
				whitespace();
				if (source[position++] !== ":") return fail();
				result[key] = value(depth + 1);
				whitespace();
				const delimiter = source[position++];
				if (delimiter === "}") return result;
				if (delimiter !== ",") return fail();
			}
			return fail();
		}
		if (character === "[") {
			position += 1;
			whitespace();
			const result = [];
			if (source[position] === "]") {
				position += 1;
				return result;
			}
			while (position < source.length) {
				result.push(value(depth + 1));
				whitespace();
				const delimiter = source[position++];
				if (delimiter === "]") return result;
				if (delimiter !== ",") return fail();
			}
			return fail();
		}
		for (const [literal, parsed] of [
			["true", true],
			["false", false],
			["null", null]
		]) if (source.startsWith(literal, position)) {
			position += literal.length;
			return parsed;
		}
		const numeric = source.slice(position).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
		if (numeric) {
			position += numeric[0].length;
			return readNumber(numeric[0]);
		}
		return fail();
	}
	const result = value(0);
	whitespace();
	if (position !== source.length) fail();
	return result;
}
function displayPath(parts) {
	return "$" + parts.map((part) => typeof part === "number" ? `[${part}]` : /^[A-Za-z_$][\w$]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`).join("");
}
// src/domain/input-contract.ts
const CONTRACT_LIMITS = {
	bytes: 32768,
	nodes: 128,
	depth: 12,
	properties: 64,
	enum: 32,
	relations: 32,
	stringLength: 4096
};
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const FORBIDDEN_KEYS = /* @__PURE__ */ new Set([
	"__proto__",
	"prototype",
	"constructor"
]);
function fail(message) {
	throw new PayloadError(`Input contract: ${message}`);
}
function record(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype);
}
function safeObject(value, depth = 0, seen = /* @__PURE__ */ new Set(), counter = { nodes: 0 }) {
	if (++counter.nodes > 2e3) fail("JSON must contain at most 2,000 values.");
	if (depth > 20) fail("object nesting is too deep.");
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number" && Number.isSafeInteger(value)) return;
	if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return;
	if (typeof value !== "object" || !value || !Array.isArray(value) && !record(value)) fail("only plain JSON values are supported.");
	if (seen.has(value)) fail("cycles are not supported.");
	seen.add(value);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Array.isArray(value) && Object.keys(descriptors).length !== value.length + 1) fail("sparse arrays or additional array properties are not supported.");
	for (const key of Reflect.ownKeys(descriptors)) {
		if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) fail("prototype-related or symbol keys are not supported.");
		if (Array.isArray(value) && key === "length") continue;
		const descriptor = descriptors[key];
		if (Array.isArray(value) && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail("additional array properties are not supported.");
		if (!descriptor.enumerable || !("value" in descriptor)) fail("only enumerable JSON data properties are supported.");
		safeObject(descriptor.value, depth + 1, seen, counter);
	}
	seen.delete(value);
}
function allowed(object, keys) {
	if (Object.keys(object).some((key) => !keys.includes(key))) fail("an unsupported keyword was supplied.");
}
function boundedInteger(value, name, maximum) {
	if (value !== void 0 && (!Number.isInteger(value) || value < 0 || value > maximum)) fail(`${name} is outside the supported bounds.`);
}
function canonicalInteger(value) {
	return typeof value === "string" && value.length <= 20 && /^(?:0|-?[1-9]\d*)$/.test(value) && BigInt(value) >= I64_MIN && BigInt(value) <= I64_MAX;
}
function pointerParts(pointer) {
	if (pointer === "") return [];
	if (pointer.length > 256 || !pointer.startsWith("/") || /~(?:[^01]|$)/.test(pointer)) fail("relations require bounded absolute JSON Pointers.");
	const parts = pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
	if (parts.some((part) => FORBIDDEN_KEYS.has(part) || part === "*")) fail("relation pointers cannot use prototype keys or wildcards.");
	return parts;
}
function parseInputContract(input) {
	if (typeof input === "string" && Buffer.byteLength(input, "utf8") > CONTRACT_LIMITS.bytes) fail("JSON must be at most 32 KiB.");
	const value = typeof input === "string" ? parsePayload(input) : input;
	safeObject(value);
	if (Buffer.byteLength(JSON.stringify(value), "utf8") > CONTRACT_LIMITS.bytes) fail("JSON must be at most 32 KiB.");
	if (!record(value)) fail("supply a version 1 object.");
	allowed(value, [
		"version",
		"schema",
		"relations"
	]);
	if (value.version !== 1) fail("only version 1 is supported.");
	let nodes = 0;
	function schema(item, depth) {
		if (++nodes > CONTRACT_LIMITS.nodes || depth > CONTRACT_LIMITS.depth) fail("schema complexity exceeds the supported bounds.");
		if (!record(item)) fail("every schema node must be an object.");
		if (item.type === "object") {
			allowed(item, [
				"type",
				"properties",
				"required",
				"additionalProperties"
			]);
			if (!record(item.properties) || Object.keys(item.properties).length > CONTRACT_LIMITS.properties || item.additionalProperties !== false) fail("objects must declare bounded properties and additionalProperties:false.");
			if (item.required !== void 0 && (!Array.isArray(item.required) || item.required.length > CONTRACT_LIMITS.properties || item.required.some((key) => typeof key !== "string" || !Object.hasOwn(item.properties, key)) || new Set(item.required).size !== item.required.length)) fail("required must contain distinct declared property names.");
			Object.values(item.properties).forEach((child) => schema(child, depth + 1));
		} else if (item.type === "array") {
			allowed(item, [
				"type",
				"items",
				"minItems",
				"maxItems"
			]);
			boundedInteger(item.minItems, "minItems", 2e3);
			boundedInteger(item.maxItems, "maxItems", 2e3);
			if (Number(item.minItems ?? 0) > Number(item.maxItems ?? 2e3)) fail("array bounds are inverted.");
			schema(item.items, depth + 1);
		} else if (item.type === "string") {
			allowed(item, [
				"type",
				"format",
				"minLength",
				"maxLength",
				"minimum",
				"maximum",
				"enum",
				"public"
			]);
			if (item.format !== void 0 && ![
				"email",
				"date",
				"date-time",
				"url",
				"integer-string"
			].includes(item.format)) fail("unsupported string format.");
			boundedInteger(item.minLength, "minLength", CONTRACT_LIMITS.stringLength);
			boundedInteger(item.maxLength, "maxLength", CONTRACT_LIMITS.stringLength);
			if (Number(item.minLength ?? 0) > Number(item.maxLength ?? CONTRACT_LIMITS.stringLength)) fail("string length bounds are inverted.");
			if ((item.minimum !== void 0 || item.maximum !== void 0) && item.format !== "integer-string") fail("string numeric bounds require integer-string format.");
			if (item.minimum !== void 0 && !canonicalInteger(item.minimum) || item.maximum !== void 0 && !canonicalInteger(item.maximum)) fail("integer-string bounds must be canonical signed 64-bit decimal strings.");
			if (BigInt(item.minimum ?? I64_MIN) > BigInt(item.maximum ?? I64_MAX)) fail("integer-string bounds are inverted.");
		} else if (item.type === "number") {
			allowed(item, [
				"type",
				"minimum",
				"maximum",
				"integer",
				"enum",
				"public"
			]);
			for (const key of ["minimum", "maximum"]) if (item[key] !== void 0 && (typeof item[key] !== "number" || !Number.isFinite(item[key]) || Math.abs(item[key]) > Number.MAX_SAFE_INTEGER)) fail("numeric bounds must be finite safe magnitudes.");
			if (item.integer !== void 0 && typeof item.integer !== "boolean") fail("integer must be boolean.");
			if (Number(item.minimum ?? -Number.MAX_SAFE_INTEGER) > Number(item.maximum ?? Number.MAX_SAFE_INTEGER)) fail("numeric bounds are inverted.");
		} else if (item.type === "boolean") allowed(item, [
			"type",
			"enum",
			"public"
		]);
		else if (item.type === "null") allowed(item, ["type"]);
		else fail("unsupported schema type.");
		if ([
			"string",
			"number",
			"boolean"
		].includes(String(item.type))) {
			if (item.public !== void 0 && item.public !== true) fail("public may only be true.");
			if (item.enum !== void 0) {
				if (item.public !== true || !Array.isArray(item.enum) || item.enum.length < 1 || item.enum.length > CONTRACT_LIMITS.enum || item.enum.some((entry) => typeof entry !== item.type) || new Set(item.enum).size !== item.enum.length) fail("enum requires distinct scalar constants and public:true.");
				if (item.enum.some((entry) => !scalarValid(entry, item, true))) fail("an enum constant violates its declared format or bounds.");
			} else if (item.public !== void 0) fail("public:true requires an explicit enum.");
		}
	}
	schema(value.schema, 0);
	if (value.relations !== void 0) {
		if (!Array.isArray(value.relations) || value.relations.length > CONTRACT_LIMITS.relations) fail("too many relations.");
		for (const relation of value.relations) {
			if (!record(relation)) fail("each relation must be an object.");
			allowed(relation, [
				"left",
				"operator",
				"right"
			]);
			if (typeof relation.left !== "string" || typeof relation.right !== "string" || ![
				"eq",
				"lt",
				"lte"
			].includes(relation.operator)) fail("unsupported relation.");
			pointerParts(relation.left);
			pointerParts(relation.right);
		}
	}
	return value;
}
function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
}
function canonicalInputContract(contract) {
	return canonical(parseInputContract(contract));
}
function inputContractHash(contract) {
	return sha256(canonicalInputContract(contract));
}
function scalarValid(value, schema, ignoreEnum = false) {
	if (schema.type === "null") return value === null;
	if (typeof value !== schema.type) return false;
	if (!ignoreEnum && schema.enum && !schema.enum.includes(value)) return false;
	if (schema.type === "string" && typeof value === "string") {
		const length = [...value].length;
		if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? CONTRACT_LIMITS.stringLength)) return false;
		if (schema.format === "email") return value.length <= 254 && /^[a-z0-9][a-z0-9._+-]*@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value);
		if (schema.format === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && (/* @__PURE__ */ new Date(`${value}T00:00:00.000Z`)).toISOString().slice(0, 10) === value;
		if (schema.format === "date-time") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"));
		if (schema.format === "url") try {
			const url = new URL(value);
			return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
		} catch {
			return false;
		}
		if (schema.format === "integer-string") return canonicalInteger(value) && BigInt(value) >= BigInt(schema.minimum ?? I64_MIN) && BigInt(value) <= BigInt(schema.maximum ?? I64_MAX);
	}
	if (schema.type === "number" && typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER && value >= (schema.minimum ?? -Number.MAX_SAFE_INTEGER) && value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER) && (!schema.integer || Number.isInteger(value));
	return true;
}
function inspect(payload, contract) {
	const located = [];
	const violations = [];
	function add(path, rule) {
		if (violations.length < 32) violations.push(`${path}: ${rule}`);
	}
	function visit(value, schema, parts) {
		const path = displayPath(parts);
		if (schema.type === "object") {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return add(path, "expected an object");
			if (Object.keys(value).some((key) => !Object.hasOwn(schema.properties, key))) add(path, "an undeclared property is present");
			if (schema.required?.some((key) => !Object.hasOwn(value, key))) add(path, "a required property is absent");
			for (const [key, child] of Object.entries(value)) if (Object.hasOwn(schema.properties, key)) visit(child, schema.properties[key], [...parts, key]);
		} else if (schema.type === "array") {
			if (!Array.isArray(value)) return add(path, "expected an array");
			if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 2e3)) add(path, "array length is outside the declared bounds");
			value.forEach((child, index) => visit(child, schema.items, [...parts, index]));
		} else if (value !== null && typeof value === "object" || !scalarValid(value, schema)) add(path, "scalar type, format, enum, or bounds differ");
		else located.push({
			leaf: {
				parts,
				path,
				fieldName: String(parts.at(-1) ?? "(root)"),
				group: "",
				value
			},
			schema
		});
	}
	visit(payload, contract.schema, []);
	function at(pointer) {
		let value = payload;
		let schema = contract.schema;
		for (const part of pointerParts(pointer)) if (schema.type === "object" && value !== null && !Array.isArray(value) && typeof value === "object" && Object.hasOwn(value, part) && Object.hasOwn(schema.properties, part)) {
			value = value[part];
			schema = schema.properties[part];
		} else if (schema.type === "array" && Array.isArray(value) && /^(?:0|[1-9]\d*)$/.test(part) && Number(part) < value.length) {
			value = value[Number(part)];
			schema = schema.items;
		} else return void 0;
		return {
			value,
			schema
		};
	}
	for (const relation of contract.relations ?? []) {
		const left = at(relation.left);
		const right = at(relation.right);
		let passed = false;
		if (left && right && left.value !== null && right.value !== null && typeof left.value !== "object" && typeof right.value !== "object" && typeof left.value === typeof right.value) {
			if (relation.operator === "eq") passed = left.value === right.value;
			else {
				const integer = left.schema.type === "string" && right.schema.type === "string" && left.schema.format === "integer-string" && right.schema.format === "integer-string";
				const temporal = left.schema.type === "string" && right.schema.type === "string" && left.schema.format === right.schema.format && ["date", "date-time"].includes(left.schema.format ?? "");
				if (typeof left.value === "number" && typeof right.value === "number") passed = relation.operator === "lt" ? left.value < right.value : left.value <= right.value;
				else if (integer && typeof left.value === "string" && typeof right.value === "string" && canonicalInteger(left.value) && canonicalInteger(right.value)) passed = relation.operator === "lt" ? BigInt(left.value) < BigInt(right.value) : BigInt(left.value) <= BigInt(right.value);
				else if (temporal && typeof left.value === "string" && typeof right.value === "string") passed = relation.operator === "lt" ? Date.parse(left.value) < Date.parse(right.value) : Date.parse(left.value) <= Date.parse(right.value);
			}
		}
		if (!passed) add("$", "a declared scalar relation is absent, unsupported for its types, or false");
	}
	return {
		located,
		violations
	};
}
function validateContractPayload(payload, contract) {
	const parsed = parseInputContract(contract);
	safeObject(payload);
	const { violations } = inspect(parsePayload(JSON.stringify(payload)), parsed);
	return {
		valid: violations.length === 0,
		violations
	};
}
export { canonicalInputContract, inputContractHash, parsePayload as parseContractPayload, parseInputContract, validateContractPayload };
