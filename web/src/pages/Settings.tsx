import { useEffect, useState } from 'react';
import { api, type CharacterInfo, type BuddyStateResponse } from '../api';
import Mascot from '../components/Mascot';
import { Loading } from '../components/Feedback';
import { toast } from '../components/Toast';

interface CharactersResponse {
  characters: CharacterInfo[];
  selectedId: string;
}

export default function Settings() {
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [prefs, setPrefs] = useState({
    reminderIntensity: 'normal',
    emotionalStyle: 'warm',
    formOfAddress: '',
    companionMode: 'companion' as 'companion' | 'quiet' | 'off' | 'active',
  });
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
        companionMode: stateRes.state.preferences.companionMode ?? 'companion',
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSelectCharacter = async (id: string) => {
    setSelectedId(id);
    await api.post('/characters/select', { characterId: id });
    // 通知全局桌宠层即时刷新角色（PetLayer 监听该事件）
    window.dispatchEvent(new CustomEvent('studymate:buddy-changed'));
    toast.push('已切换搭子', 'success');
  };

  const handleSavePrefs = async () => {
    setSaving(true);
    try {
      await api.post('/buddy/preferences', prefs);
      toast.push('偏好已保存', 'success');
    } catch {
      toast.push('保存失败，请重试', 'info');
    }
    setSaving(false);
  };

  if (loading) return <Loading />;

  return (
    <div>
      <h2 className="page-title">设置</h2>

      <h3 className="section-title">选择角色</h3>
      <div className="character-grid">
        {characters.map((char) => (
          <div
            key={char.id}
            className={`character-card${selectedId === char.id ? ' selected' : ''}`}
            onClick={() => handleSelectCharacter(char.id)}
          >
            <div className="character-avatar">
              <Mascot characterId={char.id} mood="idle" size={72} />
            </div>
            <div className="character-info">
              <p className="character-name">{char.name}</p>
              <p className="character-personality">{char.personality}</p>
              <p className="character-speech">说话风格：{char.speechStyle}</p>
              {selectedId === char.id && (
                <span className="badge badge-done">当前选择</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <h3 className="section-title">互动偏好</h3>
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
        <div className="form-group">
          <label>桌宠模式</label>
          <select
            value={prefs.companionMode}
            onChange={(e) =>
              setPrefs((p) => ({
                ...p,
                companionMode: e.target.value as 'companion' | 'quiet' | 'off' | 'active',
              }))
            }
          >
            <option value="companion">陪伴（默认）</option>
            <option value="active">活跃（陪伴 + 自动升级）</option>
            <option value="quiet">安静（不打扰）</option>
            <option value="off">关闭</option>
          </select>
          <p className="muted" style={{ marginTop: 6, fontSize: '0.78rem' }}>
            活跃档：连续学习满 3 天自动升级为主动陪伴，不足 3 天自动回落；安静 / 关闭始终生效。
          </p>
        </div>
        <button className="btn btn-primary" onClick={handleSavePrefs} disabled={saving}>
          {saving ? '保存中...' : '保存偏好'}
        </button>
      </div>

      <h3 className="section-title">外观</h3>
      <div className="card">
        <p className="muted" style={{ marginBottom: 8 }}>
          主题切换位于页面顶部，支持浅色 / 深色 / 跟随系统三种模式，选择会自动记住。
        </p>
      </div>
    </div>
  );
}
