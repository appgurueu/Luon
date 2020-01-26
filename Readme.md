![Luon Banner](luon_banner.svg)

# Luon

An implementation of ***Lu**st **o**bject **n**otation* consisting solely out of Lua literals. Think JSON for Lua.

## About

Luon is licensed under the MIT license. This specification & implementation have been written by Lars Mueller alias LMD or appgurueu.

Luon uses a similar syntax as [Lua](https://www.lua.org/license.html), which is also licensed under the MIT license.

## Features

Specification features:

* Support for comments
* More objects representable (options for table keys, table instead of list/dictionairy divide)
* Additional & neater syntax (multi-line strings, hex numbers, ...)

Implementation features:

* Designed to work with streams
* Highly customizable
* Maintainable code
* Good performance
* Unit tests

## Notation

See [the Lua 5.1 manual](https://www.lua.org/manual/5.1/manual.html). 

### Context-Free Grammar

The entire syntax (including semantic tokens) is notated in BNF as follows:

Nonterminals: `<nonterminal>`, terminals: `"terminal"`, productions: `<a1> = <b1> + "b2" + ... | ...`

```bnf
<boolean> = "true" | "false"
<null> = "nil"
<atomic> = <boolean> | <null>


<digit> = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "9"
<hex_digit> = <digit> | "a" | "b" | "c" | "d" | "e" | "f" | "A" | "B" | "C" | "D" | "E" | "F"

<digit_sequence> = <digit> | <digit> + <digit_sequence>
<signed_digit_sequence> = <digit_sequence> | -<digit_sequence>
<hex_sequence> = <hex_digit> | <hex_digit> + <hex_digit_sequence>

<decimal_content> = <signed_digit_sequence> | <signed_digit_sequence> + "." + <digit_sequence>
<hex_content> = <hex_sequence> | <hex_sequence> + "." + <hex_sequence>

<e> = "e" | "E"
<exponent> = <e> + <signed_digit_sequence>

<decimal_number> = <decimal_content> | <decimal_content> + <exponent>
<x> = "x" | "X"
<hex_number> = "0" + <x> + <hex_content>
<signed_hex_number> = <hex_number> | "-" + <hex_number>

<number> = <decimal_number> | <signed_hex_number>


<escape> = "a" | "b" | "f" | "n" | "\n" | "r" | "t" | "v" | "\\" | '"' | "'" | "[" | "]"
<escape_not_required> = _ \ "\n"
<quoted_content> = "\\" + <escape> + <quoted_content> | <escape_not_required> + <quoted_content>

<single_quoted> = "'" + <quoted_content> + "'"
<double_quoted> = "\"" + <quoted_content> + "\""
<quoted> = <single_quoted> | <double_quoted>

<long_content> = _ | _ + <long_content>
<long_content_brackets> = "[" + <long_content> + "]"
<long_bracket> = <long_content_brackets> | "=" + <long_content_brackets> + "="
<long> = "[" + <long_bracket> + "]"

<text> = <quoted> | <long>


<space> = " " | "\t" | "\n"
<spaces> = <space> | <space> + <spaces>


<val> = <atomic> | <number> | <text> | <table>
<spaced_val> = <val> | val + <spaces>
<value> = <spaced_val> | <spaces> + <spaced_val>

<letter_or_underscore> = A-z | "_"
<identifier> = <letter_or_underscore> | <identifier> + <letter_or_underscore> | <identifier> + <number>
<table_key> = "[" + <value> + "]" | <identifier>
<table_key_spaced> = <table_key> | <table_key> + <spaces>
<table_entry> = <value> | <table_key_spaced> + "=" + <value>
<table_entry_comma> = <table_entry> | <table_entry_comma>
<table_entry_spaced> = <table_entry_comma> | <table_entry_comma> + <spaces>
<tablecontent> = <table_entry_spaced> | <table_entry_spaced> <tablecontent>
<table> = "{" + <tablecontent> + "}"
```

All valid Luon text can be matched as `<value>`.

### Data Types

All in all, Luon supports the following data types:

* Atomics
  * Booleans (true/false)
  * Null (nil)
* Numbers (double)
* Text (string)
* Table

#### Atomics

The booleans `true`, `false` and the undefined/null-state `nil`.

#### Numbers

Decimal notation supporting exponents using `e` or case-insensitive hex notation using `0x`. Both number formats allow a decimal point (`.`).

#### Text

Text, also known as string, usually uses single quotes, double quotes, or long notation. Also see [PIL 2.4](https://www.lua.org/pil/2.4.html) for reference. 

Valid escape sequences: 

* `\a` - bell, optional
* `\b` - backspace, optional
* `\f` - form feed, optional
* `\n` or `\N` (with `N` being the ASCII newline character) - newline, **required**
* `\r` - carriage return, **required**
* `\t` - tab, optional
* `\v` - vertical tab, optional
* `\\` - backslash, **required**
* `\"` - double quotes, **required in double quoted strings**
* `\'` - single quotes, **required in single quoted strings**
* `\[` - opening square bracket, optional
* `\]` - closing square bracket, optional
* `\ddd` - decimal ASCII escape sequence, unicode characters have to be encoded using UTF-8, theoretically optional, but recommended for control characters (like `\000`)

Double quotes: Text is wrapped inside `"` and `"`. Special characters need to be escaped. `"` needs to be escaped as well.

Single quotes: Same, but `'` is used and needs to be escaped.

Long notation: Started by `[` + multiple equal signs + `[`, terminated by the same sequence with closing brackets. Enclosed text ignores escapes and is treated as-is.

#### Tables

Tables can store basically any information. They are like JS arrays *and* lists.

At heart, you can think of tables as key - value storages.

Usually, tables have a "list part" (as I use to call it), consisting of all number keys from `1` to `n`, where there is no key inbetween (Lua indices are one-based). This part can be traversed in order.

The other part is something that is comparable to JS dictionaires: A key-value lookup with no specific order. The only difference to JS is that, while rarely used in development, also non-string table keys are allowed in this "dictionairy."

Just like JS objects, tables are surrounded by curly brackets (`{` and `}`). All entries - either key-value assignments or elements to be appended to the "list part" - are separated with commata (`,`), with a trailing one being allowed.

Key-value assignments are written as `[key]=value`, with a possible shorthand being `key=value` if `key` is a string consisting only out of alphanumeric characters or underscores and doesn't start with a number.

### Comments

Luon supports long notation & line comments.

"Line comments" are started by two hyphens (`-`) and go until the end of the line. The newline is preserved.

"Long notation comments" also start with two hyphens, but are then followed by a long notation string. The entire string is treated as comment, but the newline is preserved.

Note the implementation by default doesn't remove comments unless instructed to.

## Example

```luon
{
    shorthand_key = true,
    ["spacing allowed"] = true,
    list_of_square_numbers = {1, 4, 9, 16, 25},
    [true] = nil,
    same_number = {[0x1]=true, [1]=true, [1.0]=true, [1.0e1]="allowed"},
    single_quotes = 'allowed',
    [ [[long notation for table keys without spaces allowed]]] = false,
[[
special feature        
]],
}
```

### Ambiguity

There are, obviously, different ways to represent the same objects.
All atoms (`true`, `false`, `nil`) are unambiguos. Numbers can be written in decimal notation (with varying exponents) or as hex.
Strings have 3 different notations (single quotes, double quotes, long notation), and there are different ways of escaping.
Tables also have various notations - keys can be given in any order, but also list notation can be used.

## API

The API **can read Lua 5.4** compatible Luon, but **writes Lua 5.1** compatible Luon.
Methods may raise errors for invalid objects (for instance functions) or invalid Luon.

### Import

```javascript
const luon=require("luon");
```

### Streams

Luon works with strings and stream objects:

* `InputStream`: provides an `stream.read()` method to read a single character. **Luon expects `InputStream`s to be UTF-8.**
* `OutputStream`: provides a `stream.write(text)` method to write a string

For that purpose, it provides the following utility classes:

* `StringReader(text)`: creates an `InputStream` from a string
* `BufferedReader(text)`: creates an `InputStream` from an `InputStream` providing a `read()` method which returns chunks of data instead of single characters
* `StringBuilder()`: creates an `OutputStream`

Under the hood, strings are always wrapped using `StringReader` streams.
Therefore, strings and streams can always both be used when input is needed.

### `luon.removeComments(text, [out])`

Removes Lua comments from the given text. Writes to `out` (=`new StringBuilder()` if omitted) and returns `out`. Also works for non-luon text like Lua files. 
Guaranteed to work for input complying to the Lua syntax. Undefined behavior else. Returns `out`.

#### `luon.removeCommentsText(text)`

Shorthand for `luon.removeComments(text).text`.

### `luon.removeSpacing(text, [out])`

Removes Luon spacing from the given text. Writes to `out` (=`new StringBuilder()` if omitted) and returns `out`. Does not necessarily work for Lua files as those require newlines to separate expressions. As such, the following Lua:

```lua
a=1
b=2
```

would be converted to this undesirable code:

```lua
a=1b=2
```

Because of this, this method should not be used for non-luon text.

#### `luon.removeSpacingText(text)`

Shorthand for `luon.removeSpacing(text).text`.

### `luon.reader({error_handler: function, remove_comments: boolean})`

Convert object from Lua Object Notation to a JavaScript object, as follows:

* `nil` is converted to `undefined`
* Booleans `true`/`false` are same
* Numbers are converted to JS numbers (floats)
* Strings are converted to JS strings
* Tables, if they only have keys from 1-n, are converted to JS arrays
* Tables, if they only have string keys, are converted to JS objects
* Tables, if they have mixed keys, are converted to a `Map` object

#### `reader.read(text)`

Returns an object.

### `luon.read(text)`

Shorthand for `luon.reader().read(text)`.

### `luon.writer([config_or_name])`

Create a writer object with the given configuration. Examples:

```javascript
const writer = luon.writer(); // writer with default config
const default = luon.writer("default"); // same as above, writer === default
const compress = luon.writer("compress"); // compresses resulting Luon to be as small as possible (in bytes)
const pretty = luon.writer("pretty"); // pretty writer, attempts human readable notation (indentation etc)
const custom = luon.writer("custom", {number_format: "hex"}); // custom writer, forces numbers to be hex
```

##### `compress`

Always uses the representation of an object taking the least space. Involves hex numbers and unusual exponents. No unnecessary whitespaces or indentation are added.

##### `pretty`

Neatly format an object to make it as easily recognizable as possible. Involves additional whitespaces, indentation and the like.

##### `custom`

Things which can be specified:
* `number`: How numbers are formatted (hex/mantisse/exp)
* `string`: How strings are formatted (single/double/long)
* `table`: Table options, comma & colon formatting, line breaking rules, indentation
* `remove_comments`: Boolean

#### `writer.write(object, [output])`

If output is given, writes to output. Else writes to rope which is then turned to string.
Writes the given object using the given writer to Lua Object Notation. Returns string if no output given, else returns success.

### `luon.write(object, [out])`

Shorthand for `luon.writer().write(object, [out])`.

#### `luon.writeText(object)`

Shorthand for `luon.write(object).text`.

### `luon.writeCompressed(object, [out])`

Shorthand for `luon.writer("compress").write(object, [out])`.

#### `luon.writeCompressedText(object)`

Shorthand for `luon.writeCompressed(object).text`.

### `luon.writeBeautified(object, [out])`

Shorthand for `luon.writer("beautify").write(object, [out])`.

#### `luon.writeBeautifiedText(object)`

Shorthand for `luon.writeBeautified(object).text`.

## Notes

Recommended file extensions: `.lua` or `.luon`. Plain text (`.txt`) is fine as well.