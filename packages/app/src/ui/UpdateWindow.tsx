import { useMemo } from 'preact/hooks';
import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { ScriptActions } from './ScriptsPanel';
import { Button } from './kit';
import { diffHunks, updateOffer } from '../builder/shelf';

/**
 * What updating a robot's copy of a behavior to the shelf's newer version would change (M16): the copy against the
 * new text, before anything is replaced, with a warning when the copy was edited on this robot. Update is one undo
 * step and keeps the settings, the key and the groups.
 */
export function UpdateWindow({ store, actions }: { store: Store<AppState>; actions: Pick<ScriptActions, 'showBehaviorUpdate' | 'applyBehaviorUpdate'> }) {
  const id = useStore(store, (s) => s.behaviorUpdate);
  const source = useStore(store, (s) => {
    const spec = s.builder.controls.scripts.find((x) => x.id === s.behaviorUpdate);
    return typeof spec?.source === 'string' ? spec.source : undefined;
  });
  const shelf = useStore(store, (s) => s.shelf.entries);
  const offer = useMemo(() => (source !== undefined ? updateOffer(source, shelf) : undefined), [source, shelf]);
  if (id === undefined) return null;
  const close = (): void => actions.showBehaviorUpdate(undefined);
  return (
    <div class="over lib upd" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div class="win plate" role="dialog" aria-label="Update a behavior">
        <div class="edhead">
          <span class="h" style={{ fontSize: '15px' }}>
            {offer ? `Update ${offer.name}: version ${offer.from} to ${offer.to}` : 'Update'}
          </span>
          <span class="gap" />
          <Button onClick={close}>Cancel</Button>
          {offer && (
            <Button kind="go" onClick={() => actions.applyBehaviorUpdate(id)} title="Replace this robot's copy with the shelf's text. One undo step.">
              Update
            </Button>
          )}
        </div>
        {!offer ? (
          <p class="empty">The shelf has nothing newer for this script.</p>
        ) : (
          <>
            <div class="upd-say">
              {offer.edited === true && (
                <p class="warn-text">
                  <b>This copy was edited on this robot.</b> Updating replaces it with the shelf's text, so those edits go. The lines in red below are what is lost. Undo brings them back.
                </p>
              )}
              {offer.edited === false && <p>This copy was not edited here, so nothing of yours is lost.</p>}
              {offer.edited === undefined && <p class="warn-text">This copy carries no mark of how it left the shelf, so it may have been edited here. The lines in red below are what the update takes out.</p>}
              <p class="dim">
                {offer.added} line{offer.added === 1 ? '' : 's'} in, {offer.removed} out. The settings on its card, its key and the groups its slots filled stay as they are.
              </p>
            </div>
            <div class="scroll diff mono">
              {offer.added + offer.removed === 0 && <p class="empty">Only the version number is different.</p>}
              {diffHunks(offer.diff, 3).map((d, i) =>
                d.kind === 'gap' ? (
                  <div class="gapline" key={i}>
                    {d.lines} line{d.lines === 1 ? '' : 's'} the same
                  </div>
                ) : (
                  <div class={`dl ${d.kind}`} key={i}>
                    <span class="ln">{d.a ?? ''}</span>
                    <span class="ln">{d.b ?? ''}</span>
                    <span class="sg">{d.kind === 'add' ? '+' : d.kind === 'del' ? '-' : ' '}</span>
                    <span class="tx">{d.text === '' ? ' ' : d.text}</span>
                  </div>
                ),
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
