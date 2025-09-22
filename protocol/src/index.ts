export type FragmentMethod =
  | 'frag.event.didOpenDocument'
  | 'frag.event.didChangeDocument'
  | 'frag.event.didCloseDocument'
  | 'frag.event.didPersistDocument'
  | 'frag.action.pullFragments'
  | 'frag.action.pushFragments'
  | 'frag.action.changeVersion'
  | 'frag.action.insertMarker'
  | 'frag.query.getVersion'
  | 'frag.query.getFragmentPositions'
  | 'frag.query.getAllFragmentRanges';

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

export interface DidOpenDocumentParams {
  textDocument: TextDocumentItem;
}

export interface DidChangeDocumentParams {
  textDocument: {
    uri: string;
    version: number;
  };
  contentChanges: Array<{ text: string }>;
}

export interface DidCloseDocumentParams {
  textDocument: TextDocumentIdentifier;
}

export interface PullFragmentsParams {
  textDocument?: TextDocumentIdentifier;
  filePath?: string;
}

export interface PullFragmentsResult {
  success: true;
  newContent: string;
  appliedCount: number;
  hasChanges: boolean;
}

export interface PushFragmentsParams {
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

export interface PushFragmentsSuccess {
  success: true;
  activeVersion: string;
  fragmentsSaved: number;
  issues?: undefined;
}

export interface PushFragmentsFailure {
  success: false;
  activeVersion: string;
  fragmentsSaved: 0;
  issues: FragmentIssue[];
}

export type PushFragmentsResult = PushFragmentsSuccess | PushFragmentsFailure;

export interface ChangeVersionParams {
  version: string;
}

export interface FragmentDocumentChange {
  uri: string;
  content: string;
  revision: number;
}

export interface FragmentChangeVersionResult {
  success: true;
  version: string;
  documents: FragmentDocumentChange[];
  removedUris: string[];
}

export interface InsertMarkerParams {
  languageId: string;
  lineContent?: string;
  indentation?: string;
}

export interface InsertMarkerResult {
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

export interface MarkerPositionsParams {
  textDocument: TextDocumentIdentifier;
  line: number;
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

export interface AllRangesParams {
  textDocument: TextDocumentIdentifier;
}

export interface FragmentOperationResult {
  success: true;
}

export interface DidPersistDocumentParams {
  uri: string;
  revision: number;
}

export type FragmentRequestParams = {
  'frag.event.didOpenDocument': DidOpenDocumentParams;
  'frag.event.didChangeDocument': DidChangeDocumentParams;
  'frag.event.didCloseDocument': DidCloseDocumentParams;
  'frag.event.didPersistDocument': DidPersistDocumentParams;
  'frag.action.pullFragments': PullFragmentsParams;
  'frag.action.pushFragments': PushFragmentsParams;
  'frag.action.changeVersion': ChangeVersionParams;
  'frag.action.insertMarker': InsertMarkerParams;
  'frag.query.getVersion': Record<string, never>;
  'frag.query.getFragmentPositions': MarkerPositionsParams;
  'frag.query.getAllFragmentRanges': AllRangesParams;
};

export type FragmentResponseResults = {
  'frag.event.didOpenDocument': FragmentOperationResult;
  'frag.event.didChangeDocument': FragmentOperationResult;
  'frag.event.didCloseDocument': FragmentOperationResult;
  'frag.event.didPersistDocument': FragmentOperationResult;
  'frag.action.pullFragments': PullFragmentsResult;
  'frag.action.pushFragments': PushFragmentsResult;
  'frag.action.changeVersion': FragmentChangeVersionResult;
  'frag.action.insertMarker': InsertMarkerResult;
  'frag.query.getVersion': FragmentVersionInfo;
  'frag.query.getFragmentPositions': FragmentMarkerRangesResult;
  'frag.query.getAllFragmentRanges': FragmentAllRangesResult;
};

export type FragmentRequestHandler<TMethod extends FragmentMethod> = (
  params: FragmentRequestParams[TMethod]
) => Promise<FragmentResponseResults[TMethod]>;

export type FragmentHandlers = {
  [K in FragmentMethod]: FragmentRequestHandler<K>;
};
