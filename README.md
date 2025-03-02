# HQL Language Support for VS Code

This extension provides rich language support for HQL (Higher Level Query Language) in Visual Studio Code. HQL is a modern LISP dialect that runs natively on JavaScript runtimes, inspired by both Swift and Clojure.

## Features

- **Syntax Highlighting**: Get accurate syntax highlighting for all HQL code constructs.
- **Autocomplete**: Enjoy context-aware code completions for symbols, built-in functions, and more.
- **Parameter Info**: See parameter information when calling functions.
- **Hover Information**: View documentation when hovering over symbols and expressions.
- **Error Checking**: Get real-time error diagnostics as you type.
- **Code Navigation**: Jump to definitions and find all references with ease.
- **Document Outline**: Use the outline view to navigate through symbols in your document.
- **Formatting**: Automatically format your code according to HQL style guidelines.
- **Rename Refactoring**: Safely rename symbols across your project.
- **Type Checking**: Get type inference and error detection for HQL code.

## Supported Language Features

The HQL Language Server supports the following language features:

- **Variable declarations** with `def`
- **Function declarations** with `defn`
- **Anonymous functions** with `fn`
- **Type annotations** with `:` and `->`
- **Conditionals** with `if` and `cond`
- **Loops** with `for`
- **Local bindings** with `let`
- **Enumeration declarations** with `defenum`
- **Modules** with `import` and `export`
- **Collections** with vectors `[]`, lists, hash-maps `{}`, and sets `#[]`
- **Named parameters** for function calls
- **String interpolation** with `\\()`

## Example

```hql
;; Define a function with type annotations and a return type
(defn calculate-area (width: Number height: Number) -> Number
  (* width height))

;; Call the function with named parameters
(def area (calculate-area width: 10 height: 20))

;; Print the result
(print "The area is" area "square units")
```

## Requirements

- VS Code 1.74.0 or higher

## Extension Settings

This extension contributes the following settings:

* `hql.maxNumberOfProblems`: Controls the maximum number of problems produced by the server.
* `hql.trace.server`: Traces the communication between VS Code and the language server.
* `hql.format.indentSize`: The size of indentation in spaces or tabs.
* `hql.format.insertSpaces`: Insert spaces when pressing Tab.

## Known Issues

- Type checking is limited in nested expressions.
- Some complex refactorings might not work as expected.

## Release Notes

### 1.0.0

- Initial release of HQL Language Support

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the MIT License.