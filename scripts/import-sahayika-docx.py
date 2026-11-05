#!/usr/bin/env python3
"""Imports the Sahayika bot script (.docx tables: Line ID | When | English | Hindi) into content/sahayika.script.json.
Usage: python3 scripts/import-sahayika-docx.py <script.docx>"""
import json, re, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "content/sahayika.script.json"
MAIN = ["primary", "secondary", "pro"]
ALL = ["trial", *MAIN]

# docx Line ID -> script line ids (a list fans one line out to several rounds)
def per(rounds, rest): return [f"{r}.{rest}" for r in rounds]
MAP = {
    **{f"W-{i:02d}": [f"before_game.briefing.w{i:02d}"] for i in range(1, 12)},
    "H-01": ["landing.screen.welcome"], "H-02": ["landing.screen.idle"], "H-03": ["landing.hover.trial"], "H-04": ["landing.hover.primary"],
    "H-05": ["landing.hover.secondary"], "H-06": ["landing.hover.pro"], "H-07": ["landing.hover.varchaspati"], "H-08": ["landing.screen.locked"],
    "H-09": ["landing.screen.start"],
    "R-01": ["before_game.screen.registration_open"], "R-02": ["before_game.registration.name"], "R-03": ["before_game.registration.mobile"],
    "R-04": ["before_game.registration.email"], "R-05": ["before_game.registration.office"], "R-06": ["before_game.registration.address"],
    "R-07": ["before_game.registration.rewards"], "R-08": ["before_game.registration.error"], "R-09": ["before_game.registration.signin"],
    "R-10": ["before_game.registration.verify"],
    "Y-01": ["before_game.screen.registration_done"], "Y-02": ["before_game.welcome.listen"], "Y-03": ["before_game.welcome.idle"],
    "Y-04": ["before_game.welcome.credits_meter"], "Y-05": ["before_game.welcome.leaderboard"], "Y-06": ["before_game.welcome.start_training"],
    "M-01": ["before_game.screen.how_to_play_new", "before_game.training.m01"],
    **{f"{k}-{i:02d}": [f"before_game.training.{k.lower()}{i:02d}"] for k, n in (("M", 6), ("S", 8), ("T", 7)) for i in range(1, n + 1) if f"{k}-{i:02d}" != "M-01"},
    "B-T1": ["trial.pre_round.first_chance"], "B-T2": ["trial.pre_round.mic_test"], "B-T3": ["trial.pre_round.tip.1"],
    "B-P1": ["primary.pre_round.first_chance"], "B-P2": ["primary.pre_round.typing_only_notice", "primary.pre_round.tip.1"], "B-P3": ["primary.pre_round.encourage"],
    "B-S1": ["secondary.pre_round.first_chance"], "B-S2": ["secondary.pre_round.tip.1"],
    "B-X1": ["pro.pre_round.first_chance"], "B-X2": ["pro.pre_round.tip.1"], "B-X3": ["pro.pre_round.encourage"],
    "B-C2": per(ALL, "pre_round.retry"), "B-C3": per(ALL, "pre_round.retry_last"), "B-C3b": per(ALL, "pre_round.retry_last_won"),
    "B-GO": per(ALL, "in_round.round_start_followup"),
    "K-T1": ["trial.in_round.round_start"], "K-T2": ["trial.in_round.first_sentence"], "K-P1": per(MAIN, "in_round.round_start"),
    "K-03": per(ALL, "in_round.half_parts_done"), "K-04": per(ALL, "in_round.half_time"), "K-05": per(ALL, "in_round.five_min_left"),
    "K-06": per(ALL, "in_round.one_min_left"), "K-07": per(ALL, "in_round.under_source"), "K-08": per(ALL, "in_round.number_mismatch"),
    "K-09": per(ALL, "in_round.copy_paste_blocked"), "K-10": per(ALL, "in_round.left_tab"), "K-11": per(ALL, "in_round.all_done_before_submit"),
    "K-12": per(ALL, "in_round.submit_with_parts_left"), "K-13": per(ALL, "in_round.submitted"),
    "A-01": per(ALL, "chat.panel_open"), "A-03": per(ALL, "chat.ask_score"), "A-04": per(ALL, "chat.ask_glossary"), "A-05": per(ALL, "chat.ask_time"),
    "A-05b": per(ALL, "chat.ask_time_behind"), "A-06": per(ALL, "chat.translate_refused"), "A-07": per(ALL, "chat.term_not_found"), "A-08": per(ALL, "chat.panel_close"),
    "E-01": per(ALL, "report_card.opening"), "E-T": ["trial.report_card.title_earned_first_chance"], "E-P": ["primary.report_card.title_earned_first_chance"],
    "E-S": ["secondary.report_card.title_earned_first_chance"], "E-X": ["pro.report_card.title_earned_first_chance"], "E-H": per(ALL, "report_card.high_score"),
    "E-N": per(ALL, "report_card.so_close"), "E-L": per(ALL, "report_card.below_pass_chances_left"), "E-Z": per(ALL, "report_card.below_pass_no_chances"),
    "E-B": per(ALL, "report_card.new_best"), "E-K": per(ALL, "report_card.not_new_best"),
    "E-1": per(ALL, "report_card.tip_weak_translation"), "E-2": per(ALL, "report_card.tip_weak_completion"), "E-4": per(ALL, "report_card.tip_weak_sentence"),
    "E-5": per(ALL, "report_card.tip_weak_time"),
    "E-R": per(ALL, "report_card.btn_retry"), "E-V": per(ALL, "report_card.btn_review"), "E-X2": per(ALL, "report_card.btn_next"),
    "J-01": ["end.journey.welcome_back"], "J-02": ["end.journey.chances_left"], "J-03": ["pro.report_card.all_rounds_played"],
}
# docx placeholder names -> the game's placeholder names
VARS = {"best": "best_score", "needed": "marks_short", "minutes_left": "time_left"}
# Mark-as-done was removed (work autosaves): wording that still asks for it
EDITS = {
    "K-P1": [(r"then click Mark as done.*$", "and your work saves automatically.")],
    "K-05": [(r" and make sure everything is ticked", "")],
}


def clean(s: str) -> str:
    s = s.replace("SAHAYIKA ", "Sahayika").replace("SAHAYIKA", "Sahayika").replace("सहायिका ,", "सहायिका,")
    s = re.sub(r"\{(\w+)\}", lambda m: "{" + VARS.get(m.group(1), m.group(1)) + "}", s)
    s = s.replace("Sahayika,", "Sahayika,").replace(" ,", ",").replace("!.", "!").replace("..", ".").replace(",।", "।")
    return re.sub(r"[ \t]+", " ", re.sub(r"\s*\n\s*", " ", s)).strip()


def rows(docx: str):
    x = zipfile.ZipFile(docx).read("word/document.xml").decode()
    for tbl in re.findall(r"<w:tbl>.*?</w:tbl>", x, re.S):
        for r in re.findall(r"<w:tr[ >].*?</w:tr>", tbl, re.S):
            cells = ["\n".join("".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", p, re.S)) for p in re.findall(r"<w:p[ >].*?</w:p>", c, re.S)).strip()
                     for c in re.findall(r"<w:tc>.*?</w:tc>", r, re.S)]
            if len(cells) == 4 and re.match(r"^[A-Z]-[A-Z0-9]+b?$", cells[0]):
                yield cells


def main(docx: str):
    d = json.loads(SCRIPT.read_text())
    by_id = {l["id"]: l for l in d["lines"]}
    seen = set()
    for lid, when, en, hi in rows(docx):
        targets = MAP.get(lid)
        if not targets:
            print("unmapped", lid); continue
        for pat, rep in EDITS.get(lid, []):
            en = re.sub(pat, rep, en.strip(), flags=re.S)
        for tid in targets:
            section, part, *moment = tid.split(".")
            line = by_id.get(tid) or {"id": tid, "section": section, "part": part, "moment": ".".join(moment), "spoken": True}
            line.update({"when": clean(when), "en": clean(en), "hi": clean(hi), "scriptId": lid})
            if tid not in by_id:
                d["lines"].append(line); by_id[tid] = line
            seen.add(tid)
    # tips the new script no longer has
    d["lines"] = [l for l in d["lines"] if not (l["part"] == "pre_round" and l["moment"].startswith("tip.") and l["id"] not in seen)]
    d["placeholders"] = sorted(set(d["placeholders"]) | {"old_best", "done", "total", "next_chance", "next_level", "level"})
    d["_comment"] = "Sahayika script: lines with scriptId come from the Sahayika bot script (.docx) via scripts/import-sahayika-docx.py; others are UI copy kept from the earlier guide script."
    SCRIPT.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(seen)} lines from the docx; {len(d['lines'])} lines total")


if __name__ == "__main__":
    main(sys.argv[1])
