import { describe, expect, it } from "vite-plus/test";
import { soundEffects } from "./audio/sfx-registry";
import { captureLedger } from "./reward-ledger";
import { rewardPresentations } from "./reward-presentation";
import { coinEntry, ledgerTotal, type RewardEntry } from "./stage-rewards";

const presentRow: RewardEntry = {
  source: "stage.present",
  label: "Present",
  effects: [
    {
      id: "grant",
      config: { command: { id: "grant-unowned-passive", config: {} }, granted: ["present.1"] },
    },
  ],
  presentation: "present",
};

describe("Present ledger row (#650; doc/presents.md, 'Mixed reward ledger and sound')", () => {
  it("is registered with its own cue, a registered sound with a stand-in", () => {
    expect(rewardPresentations.get("present").cue).toBe("reward.present");
    const sound = soundEffects.find(({ id }) => id === "reward.present");
    expect(sound?.placeholder).toBe("reward.coin");
  });

  it("follows the cash rows with 'Present added' and its cue, adding nothing to the coins", () => {
    const entries = [coinEntry("stage.complete", "Stage complete bonus", 4), presentRow];
    const ledger = captureLedger({ entries, balanceBefore: 10, balance: 14 });
    expect(ledger.rows).toEqual([
      { label: "Stage complete bonus", value: "+4 coins", cue: "reward.coin" },
      { label: "Present", value: "Present added", cue: "reward.present" },
    ]);
    expect(ledger.totals.total).toBe("+4");
    expect(ledgerTotal(entries)).toBe(4);
  });

  it("never names the hidden contents", () => {
    expect(rewardPresentations.get("present").value(presentRow)).toBe("Present added");
  });
});
