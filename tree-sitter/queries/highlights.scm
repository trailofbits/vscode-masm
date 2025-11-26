; Comments
(comment) @comment
(doc_comment) @comment.documentation

; Keywords
[
  "begin"
  "end"
  "proc"
  "use"
  "const"
  "if"
  "else"
  "while"
  "repeat"
  "true"
  "false"
] @keyword

; Visibility modifier
(visibility) @keyword

; Instructions
(simple_instruction) @keyword
(instruction_name) @keyword

; Functions/Procedures
(procedure
  (identifier) @function)

; Procedure parameters
(proc_param
  (identifier) @variable.parameter)

; Type names
(type_name) @type

; Event function
(event_call
  "event" @function.builtin)

; Constants
(const_identifier) @constant

; Modules/Paths
(path
  (identifier) @namespace)

; Annotations
(annotation
  "@" @attribute
  (identifier) @attribute)

; Numbers
(number) @number
(hex_number) @number

; Strings
(string) @string

; Operators
[
  "+"
  "-"
  "*"
  "/"
  "//"
  "="
  "->"
  "::"
  "."
] @operator

; Punctuation
[
  "("
  ")"
] @punctuation.bracket
