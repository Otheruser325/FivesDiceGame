export default class ChallengeManager {
    static STORAGE_KEY = 'protodice_challenges';
    static CONFIG_KEY = 'localConfigSettings';
    static STATUSES = {
        NOT_READY: 'not_ready',
        FAIL: 'fail',
        COMPLETE: 'complete'
    };
    static REWARDS = {
        daily: 200,
        deucifer: 1000
    };

    static getTodayKey(date = new Date()) {
        const pad = (n) => String(n).padStart(2, '0');
        const yyyy = date.getFullYear();
        const mm = pad(date.getMonth() + 1);
        const dd = pad(date.getDate());
        return `${yyyy}-${mm}-${dd}`;
    }

    static getSeededRandom(seed) {
        let x = 0;
        for (let i = 0; i < seed.length; i++) {
            x += seed.charCodeAt(i);
        }
        return function() {
            x = (x * 9301 + 49297) % 233280;
            return x / 233280;
        };
    }

    static getReward(key) {
        return Number(this.REWARDS[key] || 0);
    }

    static getConfigSnapshot() {
        const defaults = {
            switchSides: false,
            diceCount: 1,
            boardRows: 5,
            boardCols: 9
        };
        try {
            const raw = localStorage.getItem(this.CONFIG_KEY);
            if (!raw) return { ...defaults };
            const parsed = JSON.parse(raw);
            return {
                switchSides: typeof parsed.switchSides === 'boolean' ? parsed.switchSides : defaults.switchSides,
                diceCount: Number.isFinite(parsed.diceCount) ? parsed.diceCount : defaults.diceCount,
                boardRows: Number.isFinite(parsed.boardRows) ? parsed.boardRows : defaults.boardRows,
                boardCols: Number.isFinite(parsed.boardCols) ? parsed.boardCols : defaults.boardCols
            };
        } catch (e) {
            return { ...defaults };
        }
    }

    static storeConfigSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return;
        const safe = {
            switchSides: !!snapshot.switchSides,
            diceCount: Number(snapshot.diceCount || 1),
            boardRows: Number(snapshot.boardRows || 5),
            boardCols: Number(snapshot.boardCols || 9)
        };
        try {
            localStorage.setItem(this.CONFIG_KEY, JSON.stringify(safe));
        } catch (e) {}
    }

    static getStatus(key, options = {}) {
        const dateKey = options.dateKey || this.getTodayKey();
        const data = this._load(dateKey);
        return data.challenges?.[key]?.status || this.STATUSES.NOT_READY;
    }

    static recordResult(key, didWin, options = {}) {
        const dateKey = options.dateKey || this.getTodayKey();
        const reward = Number.isFinite(options.reward) ? Number(options.reward) : this.getReward(key);
        const data = this._load(dateKey);
        if (!data.challenges[key]) {
            data.challenges[key] = {
                status: this.STATUSES.NOT_READY,
                lastPlayed: null,
                rewardClaimed: false
            };
        }
        if (key === 'daily') {
            data.challenges.daily.date = dateKey;
        }

        const entry = data.challenges[key];
        let rewardGranted = false;

        if (didWin) {
            if (entry.status !== this.STATUSES.COMPLETE) {
                entry.status = this.STATUSES.COMPLETE;
            }
            if (reward > 0 && !entry.rewardClaimed) {
                entry.rewardClaimed = true;
                rewardGranted = true;
            }
        } else {
            if (entry.status !== this.STATUSES.COMPLETE) {
                entry.status = this.STATUSES.FAIL;
            }
        }

        entry.lastPlayed = new Date().toISOString();
        this._save(data);

        return {
            status: entry.status,
            rewardGranted,
            reward: rewardGranted ? reward : 0
        };
    }

    static _defaultData(dateKey) {
        return {
            version: 1,
            challenges: {
                daily: {
                    status: this.STATUSES.NOT_READY,
                    date: dateKey,
                    lastPlayed: null,
                    rewardClaimed: false
                },
                deucifer: {
                    status: this.STATUSES.NOT_READY,
                    lastPlayed: null,
                    rewardClaimed: false
                }
            }
        };
    }

    static _load(dateKey) {
        let data = null;
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) data = JSON.parse(raw);
        } catch (e) {}
        if (!data || typeof data !== 'object') {
            data = this._defaultData(dateKey);
        }
        if (!data.challenges || typeof data.challenges !== 'object') {
            data.challenges = this._defaultData(dateKey).challenges;
        }
        if (!data.challenges.daily) {
            data.challenges.daily = this._defaultData(dateKey).challenges.daily;
        }
        if (!data.challenges.deucifer) {
            data.challenges.deucifer = this._defaultData(dateKey).challenges.deucifer;
        }
        if (data.challenges.daily.date !== dateKey) {
            data.challenges.daily = {
                status: this.STATUSES.NOT_READY,
                date: dateKey,
                lastPlayed: null,
                rewardClaimed: false
            };
            this._save(data);
        }
        return data;
    }

    static _save(data) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
        } catch (e) {}
    }
}
