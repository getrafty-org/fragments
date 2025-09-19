export type FragmentMethod =
  | 'textDocument/didOpen'
  | 'textDocument/didChange'
  | 'textDocument/didClose'
  | 'fragments/apply'
  | 'fragments/save'
  | 'fragments/switchVersion'
  | 'fragments/generateMarker'
  | 'fragments/getVersion'
  | 'fragments/getFragmentPositions'
  | 'fragments/getAllFragmentRanges'
  | 'fragments/init';

export interface FragmentRequestMessage<TMethod extends FragmentMethod = FragmentMethod> {
  id: number;
  method: TMethod;
  params: FragmentRequestParams[TMethod];
}

export interface FragmentResponseMessage<TMethod extends FragmentMethod = FragmentMethod> {
  id: number;
  result?: FragmentResponseResults[TMethod];
  error?: FragmentError;
}

export interface FragmentError {
  code: number;
  message: string;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface TextDocumentItem extends TextDocumentIdentifier {
  text: string;
  version: number;
}

export interface TextDocumentDidOpenParams {
  textDocument: TextDocumentItem;
}

export interface TextDocumentDidChangeParams {
  textDocument: {
    uri: string;
    version: number;
  };
  contentChanges: Array<{ text: string }>;
}

export interface TextDocumentDidCloseParams {
  textDocument: TextDocumentIdentifier;
}

export interface ApplyFragmentsParams {
  textDocument?: TextDocumentIdentifier;
  filePath?: string;
}

export interface FragmentApplyResult {
  success: true;
  newContent: string;
  appliedCount: number;
  hasChanges: boolean;
}

export interface SaveFragmentsParams {
  textDocument?: TextDocumentIdentifier;
  filePath?: string;
}

export interface FragmentIssue {
  type: 'nested-fragment';
  fragmentId: string;
  parentFragmentId: string;
  startLine: number;
  endLine: number;
  message: string;
}

export interface FragmentSaveSuccess {
  success: true;
  activeVersion: string;
  fragmentsSaved: number;
  issues?: undefined;
}

export interface FragmentSaveFailure {
  success: false;
  activeVersion: string;
  fragmentsSaved: 0;
  issues: FragmentIssue[];
}

export type FragmentSaveResult = FragmentSaveSuccess | FragmentSaveFailure;

export interface SwitchVersionParams {
  version: string;
}

export interface FragmentSwitchVersionResult {
  success: true;
  version: string;
  updatedDocuments: Array<{
    uri: string;
    result?: FragmentApplyResult;
    error?: string;
  }>;
}

export interface GenerateMarkerParams {
  languageId: string;
  lineContent?: string;
  indentation?: string;
}

export interface FragmentGenerateMarkerResult {
  success: true;
  fragmentId: string;
  markerText: string;
  insertPosition: 'line-end' | 'new-line';
}

export interface FragmentVersionInfo {
  activeVersion: string;
  availableVersions: string[];
  initialized: boolean;
}

export interface FragmentMarkerRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  isStartMarker: boolean;
  isEndMarker: boolean;
  fragmentId: string;
}

export interface FragmentMarkerRangesResult {
  success: true;
  markerRanges: FragmentMarkerRange[];
}

export interface FragmentAllRangesResult {
  success: true;
  fragments: Array<{
    id: string;
    startLine: number;
    endLine: number;
  }>;
}

export interface InitParams {
  versions?: string[];
  activeVersion?: string;
}

export interface FragmentInitResult {
  success: true;
  message: string;
}

export interface FragmentOperationResult {
  success: true;
}

export type FragmentRequestParams = {
  'textDocument/didOpen': TextDocumentDidOpenParams;
  'textDocument/didChange': TextDocumentDidChangeParams;
  'textDocument/didClose': TextDocumentDidCloseParams;
  'fragments/apply': ApplyFragmentsParams;
  'fragments/save': SaveFragmentsParams;
  'fragments/switchVersion': SwitchVersionParams;
  'fragments/generateMarker': GenerateMarkerParams;
  'fragments/getVersion': Record<string, never>;
  'fragments/getFragmentPositions': { textDocument: TextDocumentIdentifier; line: number };
  'fragments/getAllFragmentRanges': { textDocument: TextDocumentIdentifier };
  'fragments/init': InitParams;
};

export type FragmentResponseResults = {
  'textDocument/didOpen': FragmentOperationResult;
  'textDocument/didChange': FragmentOperationResult;
  'textDocument/didClose': FragmentOperationResult;
  'fragments/apply': FragmentApplyResult;
  'fragments/save': FragmentSaveResult;
  'fragments/switchVersion': FragmentSwitchVersionResult;
  'fragments/generateMarker': FragmentGenerateMarkerResult;
  'fragments/getVersion': FragmentVersionInfo;
  'fragments/getFragmentPositions': FragmentMarkerRangesResult;
  'fragments/getAllFragmentRanges': FragmentAllRangesResult;
  'fragments/init': FragmentInitResult;
};

export type FragmentRequestHandler<TMethod extends FragmentMethod> = (
  params: FragmentRequestParams[TMethod]
) => Promise<FragmentResponseResults[TMethod]>;

export type FragmentHandlers = {
  [K in FragmentMethod]: FragmentRequestHandler<K>;
};
