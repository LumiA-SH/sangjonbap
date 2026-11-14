import CharacterPanel from './CharacterPanel';
import TrainingBloodPanel from './TrainingBloodPanel';
import CharacterCarePanel from './CharacterCarePanel';
import CoinTransferPanel from './CoinTransferPanel';
import './CharacterWorkspace.css';

export default function CharacterWorkspace({
                                               character,
                                               inventory,
                                               error,
                                               busy,
                                               run,
                                               onCharacter,
                                               refresh,
                                               notify,
                                               dev = false
                                           }) {
    return (
        <div className="survival-character-layout">
            <CharacterPanel
                character={character}
                error={error}
                busy={busy}
                run={run}
                onCharacter={onCharacter}
                refresh={refresh}
                notify={notify}
                dev={dev}
            />

            <div className="survival-character-action-grid">
                <TrainingBloodPanel
                    character={character}
                    inventory={inventory}
                    busy={busy}
                    run={run}
                    refresh={refresh}
                />

                <CharacterCarePanel
                    character={character}
                    busy={busy}
                    run={run}
                    refresh={refresh}
                    notify={notify}
                />
            </div>

            <details className="survival-character-secondary">
                <summary>
                    <strong>코인 양도</strong>
                    <span>다른 캐릭터에게 코인 보내기</span>
                </summary>

                <CoinTransferPanel
                    character={character}
                    busy={busy}
                    refresh={refresh}
                />
            </details>
        </div>
    );
}