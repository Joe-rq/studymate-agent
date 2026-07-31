import { useEffect, useState } from 'react';
import { api, type CharacterInfo, type BuddyStateResponse } from '../api';

interface CharactersResponse {
  characters: CharacterInfo[];
  selectedId: string;
}

export default function Settings() {
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [prefs, setPrefs] = useState({ reminderIntensity: 'normal', emotionalStyle: 'warm', formOfAddress: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<CharactersResponse>('/characters'),
      api.get<BuddyStateResponse>('/buddy/state'),
    ]).then(([charRes, stateRes]) => {
      setCharacters(charRes.characters);
      setSelectedId(charRes.selectedId);
      setPrefs({
        reminderIntensity: stateRes.state.preferences.reminderIntensity,
        emotionalStyle: stateRes.state.preferences.emotionalStyle,
        formOfAddress: stateRes.state.preferences.formOfAddress ?? '',
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSelectCharacter = async (id: string) => {
    setSelectedId(id);
    await api.post('/characters/select', { characterId: id });
  };

  const handleSavePrefs = async () => {
    setSaving(true);
    await api.post('/buddy/preferences', prefs);
    setSaving(false);
  };

  if (loading) return <p>加载中...</p>;

  return (
    <div>
      <h2 className="page-title">设置</h2>

      <h3 style={{ fontSize: '1.1rem', margin: '16px 0 12px' }}>选择角色</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        {characters.map((char) => (
          <div
            key={char.id}
            className="card"
            style={{
              cursor: 'pointer',
              border: selectedId === char.id ? '2px solid var(--primary)' : '2px solid transparent',
            }}
            onClick={() => handleSelectCharacter(char.id)}
          >
            <div className="buddy-avatar" style={{ width: 60, height: 60, fontSize: '1.5rem', marginBottom: 8 }}>
              {char.name[0]}
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontWeight: 600 }}>{char.name}</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{char.personality}</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                说话风格：{char.speechStyle}
              </p>
              {selectedId === char.id && (
                <span className="badge badge-done" style={{ marginTop: 8 }}>当前选择</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: '1.1rem', margin: '16px 0 12px' }}>互动偏好</h3>
      <div className="card">
        <div className="form-group">
          <label>提醒强度</label>
          <select
            value={prefs.reminderIntensity}
            onChange={(e) => setPrefs((p) => ({ ...p, reminderIntensity: e.target.value }))}
          >
            <option value="gentle">温柔</option>
            <option value="normal">正常</option>
            <option value="strict">严格</option>
          </select>
        </div>
        <div className="form-group">
          <label>情感风格</label>
          <select
            value={prefs.emotionalStyle}
            onChange={(e) => setPrefs((p) => ({ ...p, emotionalStyle: e.target.value }))}
          >
            <option value="warm">温暖</option>
            <option value="neutral">中性</option>
            <option value="playful">活泼</option>
          </select>
        </div>
        <div className="form-group">
          <label>称呼（可选）</label>
          <input
            value={prefs.formOfAddress}
            onChange={(e) => setPrefs((p) => ({ ...p, formOfAddress: e.target.value }))}
            placeholder="留空使用角色默认称呼"
          />
        </div>
        <button className="btn btn-primary" onClick={handleSavePrefs} disabled={saving}>
          {saving ? '保存中...' : '保存偏好'}
        </button>
      </div>
    </div>
  );
}
