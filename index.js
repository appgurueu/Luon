/* eslint-disable quotes */
/* eslint-disable no-cond-assign */
"use strict"
const lustils = require("lustils")

/*
Constant utilities
*/

const c0 = "0".charCodeAt(0)
const ca = "a".charCodeAt(0)
const cA = "A".charCodeAt(0)

const completeDict = lustils.object.complete

const { isDigit, isLetter, isHexDigit } = lustils.parse

const { SyntaxError, InputError } = lustils.error

const { StringReader, StringBuilder, StreamLocator, StringLengthCounter, obtainInputStream, obtainOutputStream } = lustils.stream

const State = lustils.parse.MealyState
const SpecialState = lustils.parse.MealySpecialState
const MachineBase = lustils.parse.ExtendedMealyMachineBase
const Machine = lustils.parse.ExtendedMealyMachine

const complete_translations = {
	atom_expected: "atom expected",
	unclosed_long_comment: "unclosed long comment",
	unclosed_key: "unclosed table key",
	duplicated_key: "key duplicate",
	unfinished_string: "unfinished string",
	encoding_error: "encoding error",
	severe_encoding_error: "severe encoding error",
	unclosed_long_notation: "unclosed long notation",
	unfinished_table: "unfinished table",
	invalid_escape_sequence: "invalid escape sequence",
	long_notation_expected: "long notation expected",
	number_expected: "number expected",
	exponent_expected: "exponent expected",
	no_object: "not an object",
	no_value: "missing value",
	end_of_input_expected: "end of input expected"
}

function errorTranslator(translations) {
	translations = completeDict(translations, complete_translations)
	return (message, locator) => {
		throw new SyntaxError((translations[message] || message) + " at " + locator.row + ":" + locator.col)
	}
}

const defaultErrorHandler = errorTranslator({})

/*
Reader
*/

function reader(config) {
	const remove_comments = config && config.remove_comments ? true : false
	const error = (config && config.error_handler) || defaultErrorHandler

	function utf16(val, stream, last) {
		// U+0000 to U+D7FF or U+E000 to U+FFFF - only a single char needed
		if ((val >= 0 && val <= 0xd7ff) || (val >= 0xe000 && val <= 0xffff)) {
			return String.fromCharCode(val)
		} else if (val >= 0x10000) {
			// See https://en.wikipedia.org/wiki/UTF-16#Examples
			val -= 0x10000
			// high ten bits = high surrogate
			let high_surrogate = val / 0x400 + 0xd800
			// low ten bits = low surrogate, using and
			let low_surrogate = (val % 0x400) + 0xdc00
			return String.fromCharCode(high_surrogate) + String.fromCharCode(low_surrogate)
		} else {
			// decoding problematic surrogates
			error("encoding_error", stream)
			// U+D800 to U+DFFF - only decodable if unpaired with each other
			if (last && last >= 0xd800 && last < 0xdc00) {
				// low surrogate
				if (val >= 0xdc00) {
					// preceded by high surrogate
					error("severe_encoding_error", stream)
				} else {
					return String.fromCharCode(val)
				}
			} else {
				return String.fromCharCode(val) // following surrogate doesn't matter, as the BOM is clear
			}
		}
	}

	function unescape(stream, to_be_unescaped, terminator) {
		let rope = []
		let c = stream.read()
		let to_be_read = 0
		let code = 0
		let val
		upper: while (c) {
			if (val !== undefined) {
				if (to_be_read > 0) {
					to_be_read--
					if (val > 127 && val < 128 + 64) {
						val -= 128
						code *= 64
						code += val
					} else {
						error("severe_encoding_error", stream)
					}
					if (to_be_read === 0) {
						rope.push(utf16(code, stream, rope.length > 0 ? rope[rope.length - 1].charCodeAt(0) : undefined))
						val = undefined
					}
				} else {
					if (val < 128) {
						// ASCII value, can be written
						rope.push(String.fromCharCode(val))
					} else {
						// presumably UTF-8 starter sequence; if not, error
						let highest_bit = 128
						for (to_be_read = -1; to_be_read < 4; to_be_read++) {
							if (highest_bit > val) {
								break
							}
							val -= highest_bit
							highest_bit /= 2
						}
						code = val
						if (to_be_read <= 0) {
							error("severe_encoding_error", stream)
						}
					}
				}
			}
			val = undefined
			if (c === terminator) {
				return rope.join("")
			} else if (c === "\\") {
				let c2
				let k = to_be_unescaped[(c2 = stream.read())]
				if (k) {
					rope.push(k)
				} else {
					if (c2 === "x") {
						val = 0
						for (let i = 0; i < 2; i++) {
							let ci = stream.read()
							if (!isHexDigit(ci)) {
								error("invalid_escape_sequence", stream)
							}
							val *= 16
							val += hexDigitValue(ci)
						}
					} else if (c2 === "u") {
						let max = Math.pow(2, 31)
						let bracket1 = stream.read()
						if (bracket1 !== "{") {
							error("invalid_escape_sequence", stream)
						}
						let ci = stream.read()
						let charcode = 0
						do {
							if (!isHexDigit(ci)) {
								error("invalid_escape_sequence", stream)
							}
							charcode *= 16
							charcode += hexDigitValue(ci)
							if (charcode >= max) {
								error("invalid_escape_sequence", stream)
							}
						} while (ci !== "}")
						rope.push(utf16(charcode, stream, rope.length > 0 ? rope[rope.length - 1].charCodeAt(0) : undefined))
					} else if (isDigit(c2)) {
						val = digitValue(c2)
						for (let i = 0; ; i++) {
							let ci = stream.read()
							if (!isDigit(ci) || i == 2) {
								c = ci
								continue upper
							}
							val *= 10
							val += digitValue(ci)
						}
					} else {
						error("invalid_escape_sequence", stream, {
							character: c2
						})
					}
				}
			} else {
				rope.push(c)
			}
			c = stream.read()
		}
		error("unfinished_string", stream)
	}

	function readSingleQuoted(stream) {
		return unescape(stream, single_quote_unescapes, "'")
	}

	function readDoubleQuoted(stream) {
		return unescape(stream, double_quote_unescapes, '"')
	}

	function isSpace(char) {
		return {
			" ": true,
			"\t": true,
			"\n": true
		}[char]
	}

	let atoms = {
		true: true,
		false: false,
		nil: undefined
	}

	function digitValue(x) {
		return x.charCodeAt(0) - c0
	}

	function hexDigitValue(y) {
		return (x => (x >= ca ? x - ca + 10 : x >= cA ? x - cA + 10 : x - c0))(y.charCodeAt(0))
	}

	function readNumber(stream, c1) {
		let c2
		let negation = 1
		let value = 0
		let base = 10
		let value_fnc = digitValue
		if (c1 === "-") {
			negation = -negation
			c1 = stream.read()
		}
		let c
		isDecimal: {
			if (c1 === "0") {
				c2 = stream.read()
				if (c2 === "x" || c2 === "X") {
					c = stream.read()
					value_fnc = hexDigitValue
					base = 16
					break isDecimal
				} else {
					c = c2
				}
			} else if (c1 === undefined) {
				error("number_expected", stream)
			} else {
				c = c1
			}
		}

		let additional
		let floating_point = false
		let e = false
		while (c !== undefined) {
			if ((base === 10 && (c === "e" || c === "E")) || (base === 16 && (c === "p" || c === "P"))) {
				e = true
				break
			}
			if (c === ".") {
				floating_point = true
				break
			}
			additional = value_fnc(c)
			if (additional < 0 || additional >= base) {
				break
			}
			value *= base
			value += additional
			c = stream.read()
		}
		if (floating_point) {
			let factor = 1
			while ((c = stream.read()) !== undefined) {
				if ((base === 10 && (c === "e" || c === "E")) || (base === 16 && (c === "p" || c === "P"))) {
					e = true
					break
				}
				additional = value_fnc(c)
				if (additional < 0 || additional >= base) {
					return [value, c]
				}
				factor /= base
				value += factor * additional
			}
		}
		if (e) {
			let expfactor = 1
			let expbase = 10
			if (base === 16) {
				expbase = 2
				base = 10
				value_fnc = digitValue
			}
			let exp = 0
			c = stream.read()
			if (c === "+") {
				c = stream.read()
			} else if (c === "-") {
				expfactor = -expfactor
				c = stream.read()
			}
			if (c === undefined) {
				error("exponent_expected", stream)
			}
			while (c !== undefined) {
				additional = value_fnc(c)
				if (additional < 0 || additional >= base) {
					break
				}
				exp *= base
				exp += additional
				c = stream.read()
			}
			value *= Math.pow(expbase, expfactor * exp)
		}
		return [value * negation, c]
	}

	function readLongNotation(stream, second) {
		let opening_count = 0
		let opening_bracket
		if (second === "=") {
			opening_count++
		}
		if (second !== "[") {
			opening_bracket = stream.skip(x => {
				if (x === "=") {
					opening_count++
					return true
				}
				return false
			})
			if (opening_bracket !== "[") {
				error("long_notation_expected", stream)
			}
		}
		let text = ""
		let closing_count = -1
		let restore_content = () => {
			if (closing_count >= 0) {
				text += "]"
				for (let i = 0; i < closing_count; i++) {
					text += "="
				}
			}
		}
		let c
		let r = 1,
			n = 2
		let newline = 0
		while ((c = stream.read()) !== undefined) {
			if (c === "]") {
				if (closing_count === opening_count) {
					return text
				}
				restore_content()
				closing_count = 0
			} else if (c === "=" && closing_count >= 0) {
				closing_count++
			} else {
				restore_content()
				closing_count = -1
				if (c === "\r") {
					if (newline !== n) {
						newline = r
					}
				} else if (c === "\n") {
					text += c
					if (newline === r) {
						newline = 0
					} else {
						newline = n
					}
				} else {
					if (newline === r) {
						text += "\r"
					}
					newline = 0
					text += c
				}
			}
		}
		error("unclosed_long_notation", stream)
		return text
	}

	function readTable(stream) {
		let key, value
		let to_be_handled = new Map()
		let list_part = []
		let dict_part = {}
		let c
		// eslint-disable-next-line no-constant-condition
		while (true) {
			c = stream.skip(isSpace)
			let key_exists = true
			if (c === "[") {
				let next = stream.read()
				if (next === "=" || next === "[") {
					readLongNotation(stream, next)
				} else {
					[key, c] = read(stream, next)
				}
				c = isSpace(c) ? stream.skip(isSpace) : c
				if (c !== "]") {
					error("unclosed_key", stream)
				}
				c = stream.skip(isSpace)
			} else if (isLetter(c)) {
				key = c
				while ((c = stream.read()) && isLetter(c)) {
					key += c
				}
				c = isSpace(c) ? stream.skip(isSpace) : c
			} else {
				key_exists = false
				;[value, c] = read(stream, c)
				c = isSpace(c) ? stream.skip(isSpace) : c
			}
			if (key_exists) {
				if (c !== "=") {
					error("no_value", stream)
				}
				[value, c] = read(stream)
				if (typeof key === "number" && key % 1 === 0 && key >= 1) {
					to_be_handled.put(key, value)
				} else {
					dict_part[key] = value
				}
			} else {
				list_part.push(value)
			}
			c = isSpace(c) ? stream.skip(isSpace) : c
			if (c !== ",") {
				break
			}
		}
		let val
		for (let i = list_part.length + 1; (val = to_be_handled.get(i)); i++) {
			list_part.push(val)
		}
		c = isSpace(c) ? stream.skip(isSpace) : c
		if (c !== "}") {
			error("unfinished_table", stream)
		}
		let object
		if (list_part.length === 0) {
			object = dict_part
		} else {
			nodict: {
				// eslint-disable-next-line no-unused-vars
				for (let _ in dict_part) {
					object = {
						list: list_part,
						dict: dict_part
					}
					break nodict
				}
				object = list_part
			}
		}
		return object
	}

	let starter_funcs = {
		"{": readTable,
		"'": readSingleQuoted,
		'"': readDoubleQuoted,
		"[": readLongNotation
	}

	function read(stream, first) {
		let object, end_of_input
		if (first === undefined) {
			first = stream.read()
		}
		if (isSpace(first)) {
			first = stream.skip(isSpace)
		}
		parser: {
			for (let atom in atoms) {
				if (first === atom.charAt(0)) {
					for (let i = 1; i < atom.length; i++) {
						if (stream.read() !== atom.charAt(i)) {
							error("atom_expected", stream)
							break parser
						}
					}
					object = atoms[atom]
					end_of_input = stream.read()
					break parser
				}
			}
			if (isDigit(first) || first === "-") {
				[object, end_of_input] = readNumber(stream, first)
				break parser
			}
			for (let starter in starter_funcs) {
				if (first === starter) {
					object = starter_funcs[starter](stream)
					end_of_input = stream.read()
					break parser
				}
			}
			error("no_object", stream)
		}
		end_of_input = end_of_input || stream.skip(isSpace)
		return [object, end_of_input]
	}

	Object.freeze(config)
	let reader = {
		config: config,
		read: stream => {
			stream = obtainInputStream(stream)
			if (remove_comments) {
				// TODO seek a more performant way to directly pipe out >> in
				stream = new StreamLocator(new StringReader(removeComments(stream).text))
			}
			let [object, end_of_input] = read(stream, stream.read())
			if (end_of_input !== undefined) {
				error("end_of_input_expected", stream)
			}
			return object
		}
	}
	Object.freeze(reader)
	return reader
}

/*
Writer
*/

let comment_removal_machine = new MachineBase({
	opening: 0,
	closing: 0
})
let initial = comment_removal_machine.initial_state

/* Comment states */
let comment_incoming = new State()
comment_incoming.setAnyTransition({
	state: initial,
	write: "-"
})
initial.setTransition("-", {
	state: comment_incoming
}) // write nothing

let comment = new State()
comment_incoming.setTransition("-", {
	state: comment
}) // write nothing
let comment_content = new State()
comment.setAnyTransition({
	state: comment_content
})
comment_content.setTransition("\n", {
	state: initial,
	write: true
}) // newline ends a comment
comment_content.setAnyTransition({
	state: comment_content
})

// Removes an entire line
let full_line_comment_incoming = new State()
full_line_comment_incoming.setAnyTransition({
	state: initial,
	write: "\n"
})
initial.setTransition("\n", {
	state: full_line_comment_incoming
})
full_line_comment_incoming.setTransition("-", {
	state: comment
}) // write nothin'

/* States to "trap" input in so that we don't recognize comments */

function buildTraps(initial) {
	function quotes(char) {
		let quote = new State()
		initial.setTransition(char, {
			state: quote,
			write: true
		})
		quote.setTransition(char, {
			state: initial,
			write: true
		})

		let escape = new State()
		quote.setTransition("\\", {
			state: escape,
			write: true
		})
		escape.setAnyTransition({
			state: quote,
			write: true
		})
	}

	quotes("'") // Single quotes
	quotes('"') // Double quotes

	// Long notation
	function getLongNotation(source, write) {
		let obtainConsumer = (content, newline) => {
			return (machine, c) => {
				if (c === "=") {
					machine.data.closing++
					return {
						state: machine.current_state,
						write: write
					}
				} else if (c === "]") {
					if (machine.data.opening === machine.data.closing) {
						machine.data.opening = machine.data.closing = 0
						return {
							state: initial,
							write: newline ? "\n" : write ? "]" : ""
						}
					}
					machine.data.closing = 0
					return {
						state: machine.current_state,
						write: write
					}
				} else {
					return {
						state: content,
						write: write
					}
				}
			}
		}
		let long_identifier = new SpecialState()
		let long_content = new State()
		long_content.setAnyTransition({
			state: long_content,
			write: write
		})
		long_identifier.setConsumer((machine, c) => {
			if (c === "=") {
				machine.data.opening++
				return {
					state: long_identifier,
					write: write
				}
			} else if (c === "[") {
				return {
					state: long_content,
					write: write
				}
			} else {
				machine.data.opening = 0
				return {
					state: source,
					write: write
				}
			}
		})
		let long_closing_identifier = new SpecialState()
		long_closing_identifier.setConsumer(obtainConsumer(long_content, false))
		long_content.setTransition("]", {
			state: long_closing_identifier,
			write: write
		})
		source.setTransition("[", {
			state: long_identifier,
			write: write
		})
		if (!write) {
			let long_content_newline = new State()
			long_content_newline.setAnyTransition({
				state: long_content_newline
			})
			let long_closing_identifier_newline = new SpecialState()
			long_closing_identifier_newline.setConsumer(obtainConsumer(long_content_newline, true))
			long_content_newline.setTransition("]", {
				state: long_closing_identifier_newline
			})
			long_content.setTransition("\n", {
				state: long_content_newline
			})
		}
	}
	getLongNotation(initial, true)
	return getLongNotation
}

buildTraps(initial)(comment)

const removeComments = Machine.applier(comment_removal_machine)

let space_removal_machine = new MachineBase({
	opening: 0,
	closing: 0
})

initial = space_removal_machine.initial_state
initial.setAnyTransition({
	state: initial,
	write: true
})
initial.setTransition([" ", "\t", "\n"], {
	state: initial
})

// States to "trap" input in so that we don't recognize spacing

buildTraps(initial)

const removeSpacing = Machine.applier(space_removal_machine)

function numberWriter(base, digit_func, compress, prefix) {
	return (num, out, precision) => {
		if (Math.sign(num) < 0) {
			out.write("-")
			num = -num
		}
		num += Math.pow(base, -precision) / 2
		let after_comma = num % 1
		const omit_zero = compress && after_comma !== 0 && num === after_comma
		if (prefix) {
			out.write(prefix)
		}
		let digits = []
		let digit
		do {
			digit = Math.floor(num % base)
			digits.push(digit_func(digit))
			num = Math.floor(num / base)
		} while (num > 0)
		digits.reverse()
		digit = Math.floor(num)
		if (!compress || !omit_zero) {
			for (digit of digits) {
				out.write(digit)
			}
		}
		if (after_comma !== 0 && precision > 0 && after_comma >= Math.pow(base, -precision)) {
			out.write(".")
			for (; precision >= 0 && after_comma >= Math.pow(base, -precision); precision--) {
				after_comma *= base
				digit = Math.floor(after_comma % base)
				out.write(digit_func(digit))
				after_comma -= digit
			}
		}
	}
}

const decimalDigit = digit => String.fromCharCode(c0 + digit)
const writeDecimal = numberWriter(10, decimalDigit)
const writeDecimalCompressed = numberWriter(10, decimalDigit, true)
let hexWriters = {}
for (let capitalization of [ca, cA]) {
	for (let compress of [true, false]) {
		hexWriters["writeH" + (capitalization == ca ? "ex" : "EX") + (compress ? "Compressed" : "")] = numberWriter(
			16,
			digit => String.fromCharCode(digit < 10 ? c0 + digit : capitalization + digit - 10),
			compress,
			"0x"
		)
	}
}
// no use for writeHEXCompressed at the moment
const { writeHex, writeHEX, writeHexCompressed } = hexWriters

function decimalEscape(char_code) {
	let escape = String.fromCharCode((char_code % 10) + c0)
	while ((char_code = Math.floor(char_code / 10)) >= 0) {
		escape = String.fromCharCode((char_code % 10) + c0) + escape
	}
	return escape
}

function defaultIsSafe(code) {
	return code > 31
}

function safeEscape(escapes, is_safe) {
	is_safe = is_safe || defaultIsSafe
	return c => {
		let escape = escapes[c]
		if (escape) {
			return [escape, false]
		}
		let code = c.charCodeAt(0)
		if (is_safe(code)) {
			return [undefined, undefined]
		}
		return [decimalEscape(c), true]
	}
}

function escapeText(escape_func) {
	return (text, out) => {
		let decimal_escape
		for (let i = 0; i < text.length; i++) {
			let c = text.charAt(i)
			let [escape, is_short_decimal] = escape_func(c)
			if (decimal_escape !== undefined) {
				if (isDigit(c) && !escape) {
					while (decimal_escape.length < 3) {
						decimal_escape = "0" + decimal_escape
					}
				}
				out.write("\\")
				out.write(decimal_escape)
				decimal_escape = undefined
			}
			if (escape) {
				if (is_short_decimal) {
					decimal_escape = escape
				} else {
					out.write("\\")
					out.write(escape)
				}
			} else {
				out.write(c)
			}
		}
		if (decimal_escape !== undefined) {
			out.write("\\")
			out.write(decimal_escape)
		}
	}
}

function longMinIdentifier(text) {
	let used = new Set()
	let min_level = 0
	const useLevel = level => {
		if (used.has(level)) return
		used.add(level)
		while (used.has(min_level)) min_level++
	}
	for (let i = 0; i < text.length; i++) {
		let c = text.charAt(i)
		if (c === "]") {
			let level = i + 1
			while (level < text.length && text.charAt(level) === "=") {
				level++
			}
			const atEnd = i === text.length - 1
			if (text.charAt(level) === "]" || atEnd) {
				level -= 1
				useLevel(level - i)
				if (!atEnd) i = level
			}
		}
	}
	return min_level
}

/*
'\a' (bell), '\b' (backspace), '\f' (form feed), 
'\n' (newline), '\r' (carriage return), 
'\t' (horizontal tab), '\v' (vertical tab), 
'\\' (backslash), '\"' (quotation mark [double quote]), and '\'' (apostrophe [single quote])
*/

const basic_escapes = {
	// eslint-disable-next-line no-useless-escape
	"\u0007": "a",
	"\b": "b",
	"\f": "f",
	"\n": "n",
	"\r": "r",
	"\t": "t",
	"\v": "v",
	"\\": "\\"
}

let single_quote_escapes = {
	...basic_escapes,
	"'": "'"
}

let double_quote_escapes = {
	...basic_escapes,
	'"': '"'
}

let unescapes = {
	"\n": "\n"
}
for (let k in basic_escapes) {
	unescapes[basic_escapes[k]] = k
}
const single_quote_unescapes = unescapes
const double_quote_unescapes = unescapes

const writeSingle = escapeText(safeEscape(single_quote_escapes))

function writeSingleQuoted(text, out) {
	out.write("'")
	writeSingle(text, out)
	out.write("'")
}

const writeDouble = escapeText(safeEscape(double_quote_escapes))

function writeDoubleQuoted(text, out) {
	out.write('"')
	writeDouble(text, out)
	out.write('"')
}

function alphaOrUnder(c) {
	return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c == "_"
}

function shortKeyNotation(key) {
	if (key === "") {
		return false
	}
	if (!alphaOrUnder(key.charAt(0))) {
		return false
	}
	for (let i = 1; i <= key.length; i++) {
		let c = key.charAt(i)
		if (!alphaOrUnder(c) && (c < "0" || c > "9")) {
			return false
		}
	}
	return true
}

function writeLongIdentifier(output, opening, identifier) {
	let bracket = opening ? "[" : "]"
	output.write(bracket)
	for (; identifier > 0; identifier--) {
		output.write("=")
	}
	output.write(bracket)
}

function writeLongNotation(output, identifier, newline, content) {
	writeLongIdentifier(output, true, identifier)
	if (newline || content.startsWith("\n")) {
		output.write("\n")
	}
	output.write(content)
	writeLongIdentifier(output, false, identifier)
}

const confs = {
	default: {
		indent: "",
		linebreaks: false,
		number_precision: 10,
		number_format: "scientific",
		string_format: "double",
		// eslint-disable-next-line no-unused-vars
		error: function (_type, _out, _object) {
			throw new InputError({
				unsupported_object: "unsupported object"
			})
		},
		write_function: "writeLuon"
	},
	beautify: {
		indent: "  ",
		linebreaks: true,
		number_format: "beautify",
		string_format: "beautify"
	},
	compress: {
		number_format: "compress",
		string_format: "compress"
	}
}

Object.freeze(confs)

let writers = {}

function writer(conf) {
	if (!conf) {
		return writers.default
	} else if (typeof conf !== "object") {
		return writers[conf] || writers.default
	} else {
		conf = completeDict(conf, confs.default)
	}
	Object.freeze(conf)
	const { indent, linebreaks, number_format, number_precision, string_format, error, write_function } = conf

	function expNotation(zeros, compress) {
		const numberWriter = compress ? writeDecimalCompressed : writeDecimal
		return function (num, out, precision) {
			let exp = Math.floor(Math.log10(num))
			if (!Number.isFinite(exp) || Math.abs(exp) < zeros) {
				numberWriter(num, out, precision)
				return
			}
			let mant = num / Math.pow(10, exp)
			numberWriter(mant, out, precision)
			out.write("e")
			writeDecimal(exp, out, 0)
		}
	}

	function compressNum(funcs) {
		return function (num, out, precision) {
			let best = new StringBuilder()
			funcs[0](num, best, precision)
			for (let i = 1; i < funcs.length; i++) {
				let sb = new StringBuilder()
				funcs[i](num, sb, precision)
				if (sb.text.length < best.text.length) {
					best = sb
				}
			}
			out.write(best.text)
		}
	}
	const num_format = {
		hex: writeHex,
		HEX: writeHEX,
		dec: writeDecimal,
		scientific: expNotation(1),
		compress: compressNum([writeHexCompressed, writeDecimalCompressed, expNotation(1, true)]),
		beautify: expNotation(3)
	}[number_format]

	function writeNumber(num, out) {
		// NaN and Infinity map to "nil"
		if (!Number.isFinite(num)) {
			out.write("nil")
			return
		}
		num_format(num, out, number_precision)
	}

	function writeMinimalLongNotation(newline) {
		return (object, out) => {
			writeLongNotation(out, longMinIdentifier(object), newline, object)
		}
	}

	function writeCompressedText(newline) {
		return (text, out) => {
			let single_length = new StringLengthCounter()
			writeSingleQuoted(text, single_length)
			single_length = single_length.length
			let double_length = new StringLengthCounter()
			writeDoubleQuoted(text, double_length)
			double_length = double_length.length
			let long_identifier = longMinIdentifier(text)
			let long_length = new StringLengthCounter()
			writeLongNotation(long_length, long_identifier, newline, text)
			long_length = long_length.length
			if (single_length < double_length) {
				if (long_length < single_length) {
					writeLongNotation(out, long_identifier, newline, text)
				} else {
					writeSingleQuoted(text, out)
				}
			} else {
				// double_length <= single_length
				if (long_length < double_length) {
					writeLongNotation(out, long_identifier, newline, text)
				} else {
					writeDoubleQuoted(text, out)
				}
			}
		}
	}
	const writeString = {
		double: writeDoubleQuoted,
		single: writeSingleQuoted,
		long: writeMinimalLongNotation(false),
		long_newline: writeMinimalLongNotation(true),
		compress: writeCompressedText(false),
		beautify: writeCompressedText(true)
	}[string_format]

	function writeIndent(level, out) {
		if (!indent) {
			return
		}
		for (let i = 0; i < level; i++) {
			out.write(indent)
		}
	}

	function writeIndented(v, out, ind) {
		if (typeof v === "object") {
			writeObject(v, out, ind)
		} else {
			write(v, out)
		}
	}

	function writeEntry(v, out, ind) {
		writeIndent(ind, out)
		writeIndented(v, out, ind)
	}

	function writeKey(key, out, ind) {
		writeIndent(ind, out)
		if (shortKeyNotation(key)) {
			out.write(key)
		} else {
			out.write("[")
			writeIndent(ind, out)
			writeIndented(key, out, ind)
			out.write("]")
		}
		out.write("=")
	}

	function writeComma(out, needs_comma) {
		needs_comma && out.write(",")
		linebreaks && out.write("\n")
	}

	function writeObject(obj, out, old) {
		let ind = old + 1
		out.write("{")
		if (Array.isArray(obj)) {
			if (obj.length > 0) {
				linebreaks && out.write("\n")
				writeEntry(obj[0], out, ind)
				for (let i = 1; i < obj.length; i++) {
					writeComma(out, true)
					writeEntry(obj[i], out, ind)
				}
			}
		} else if (obj instanceof Map) {
			let j
			if (obj.has(1)) {
				writeEntry(obj.get(1), out, ind)
				for (j = 2; obj.has(j); j++) {
					writeComma(out, true)
					writeEntry(obj.get(j), out, ind)
				}
			}
			let needs_comma = false
			for (let key in obj) {
				if (j && key >= 1 && key < j) {
					continue
				}
				writeComma(out, needs_comma)
				writeKey(key, out, ind)
				writeIndented(obj[key], out, ind)
				needs_comma = true
			}
		} else if (obj instanceof Set) {
			let needs_comma = false
			for (let key in obj) {
				writeComma(out, needs_comma)
				writeKey(key, out, ind)
				out.write("true")
				needs_comma = true
			}
		} else {
			let needs_comma = false
			for (let key in obj) {
				writeComma(out, needs_comma)
				writeKey(key, out, ind)
				writeIndented(obj[key], out, ind)
				needs_comma = true
			}
		}
		linebreaks && out.write("\n")
		writeIndent(old, out)
		out.write("}")
	}

	function write(object, out) {
		out = obtainOutputStream(out)
		if (object === true) {
			out.write("true")
		} else if (object === false) {
			out.write("false")
		} else if (object === undefined || object === null) {
			out.write("nil")
		} else {
			let t = typeof object
			if (t === "string") {
				writeString(object, out)
			} else if (t === "number") {
				writeNumber(object, out)
			} else if (t === "object") {
				let wfunc
				if (write_function && (wfunc = object[write_function]) && typeof wfunc === "function") {
					wfunc(out)
				} else {
					writeObject(object, out, 0)
				}
			} else {
				error("unsupported_object", out, object)
			}
		}
		return out
	}
	const writer = {
		write,
		conf
	}
	Object.freeze(writer)
	return writer
}

writers.default = writer(confs.default)
writers.compress = writer(confs.compress)
writers.beautify = writer(confs.beautify)

Object.freeze(writers)

let exps = {
	removeComments,
	removeSpacing,
	reader,
	read: reader().read,
	readRemoveComments: reader({
		remove_comments: true
	}).read,
	writer,
	write: writer().write,
	writeCompressed: writer("compress").write,
	writeBeautified: writer("beautify").write
}

for (let funcname of ["removeComments", "removeSpacing", "write", "writeCompressed", "writeBeautified"]) {
	const func = exps[funcname]
	exps[funcname + "Text"] = input => func(input).text
}

Object.freeze(exps)

module.exports = exps
