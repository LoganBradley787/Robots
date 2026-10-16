import type { Store } from './store';
import { useStore } from './store';
import type { AppState } from './appState';
import type { ScriptActions } from './ScriptsPanel';
import { Button } from './kit';

/**
 * Over the board while a behavior's slot is being filled (M16): the question, what a click does, and Accept. The
 * parts picked are lit green on the board; a click on a part puts it in or takes it out, and for a slot of many,
 * Select all and Clear pick every part that could be it, or none. Esc calls the whole thing off with nothing changed;
 * Enter accepts.
 */
export function FillBanner({ store, actions }: { store: Store<AppState>; actions: Pick<ScriptActions, 'fillAccept' | 'fillPick' | 'fillSkip' | 'fillBack' | 'fillCancel'> }) {
  const fill = useStore(store, (s) => s.builder.fill);
  if (!fill) return null;
  return (
    <div class="fill-banner plate float" role="dialog" aria-label={`${fill.mode === 'add' ? 'Adding' : 'Changing'} ${fill.name}`}>
      <div class="what">
        <div class="h step">
          <i class="sw picked" />
          {fill.mode === 'add' ? 'Adding' : 'Changing'} {fill.name}
          {fill.steps > 1 ? <span class="n">{`${fill.step} of ${fill.steps}`}</span> : null}
        </div>
        <p class="q">{fill.sentence}</p>
        <p class="how">
          {fill.help}
          {fill.optional ? ' This one can be skipped.' : ''}
        </p>
      </div>
      <div class="acts">
        {fill.many && fill.picked < fill.could && (
          <Button small onClick={() => actions.fillPick(true)} title={`Pick all ${fill.could} parts that could be this`}>
            Select all
          </Button>
        )}
        {fill.many && fill.picked > 0 && (
          <Button small kind="ghost" onClick={() => actions.fillPick(false)} title="Pick none, then click the ones you want">
            Clear
          </Button>
        )}
        {fill.canBack && (
          <Button small kind="ghost" onClick={actions.fillBack} title="Pick the slot before this one again">
            Back
          </Button>
        )}
        {fill.optional && (
          <Button small onClick={actions.fillSkip} title="Leave this slot as it is">
            Skip
          </Button>
        )}
        <Button small kind="ghost" onClick={actions.fillCancel} title="Call it off: nothing is changed">
          Cancel <kbd>Esc</kbd>
        </Button>
        <Button kind="go" onClick={actions.fillAccept} disabled={fill.picked === 0 && !fill.optional} title={fill.picked === 0 && !fill.optional ? 'Pick at least one part first' : 'Use these parts'}>
          Accept <kbd>Enter</kbd>
        </Button>
      </div>
    </div>
  );
}
