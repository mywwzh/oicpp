declare const monaco: any;

declare namespace monaco {
    interface IEditorConstructionOptions {}
    interface IModelConstructionOptions {}
    interface Position { lineNumber: number; column: number; }
    interface Range { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number; }
    interface Selection { selectionStartLineNumber: number; selectionStartColumn: number; positionLineNumber: number; positionColumn: number; }
    interface ICommand {}
    interface ITextModel {}
    interface ICodeEditor {}
    interface IEditor {}
    enum KeyMod {}
    enum KeyCode {}
    enum MarkerSeverity {}
    class editor {}
    class languages {}
    class Uri {}
}
