import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {ChatInput} from '../apps/desktop/src/renderer/components/new-chat/ChatInput';
import {NewMakerDraftRoute} from '../apps/desktop/src/renderer/features/cc-agent/NewMakerDraftRoute';
import * as drafts from '../apps/desktop/src/renderer/lib/composerDraftStore';
export {React,createRoot,ChatInput,NewMakerDraftRoute,drafts};

export {useAttachments} from '../apps/desktop/src/renderer/hooks/useAttachments';

export * as providerSnapshots from '../apps/desktop/src/renderer/lib/providersSnapshotStore';
export * as owner from '../apps/desktop/src/renderer/contexts/dataOwnerGeneration';
export * as newDraft from '../apps/desktop/src/renderer/state/newMakerDraft';

export * as pendingFirst from '../apps/desktop/src/renderer/state/pendingFirstMessage';
