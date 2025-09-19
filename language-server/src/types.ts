export interface FragmentContent {
  id: string;
  versions: Record<string, string>;
  metadata?: {
    created?: Date;
    modified?: Date;
    description?: string;
  };
}

export interface ProjectFragments {
  schema: string;
  activeVersion: string;
  availableVersions: string[];
  fragments: Record<string, FragmentContent>;
  metadata: {
    created: Date;
    modified: Date;
    version: string;
  };
}
