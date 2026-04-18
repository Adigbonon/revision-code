import json
import re
import sys
from pathlib import Path
from collections import defaultdict

import pypdf


PDF_PATH = Path("/Users/rodicaadigbonon/Downloads/null.pdf")
OUTPUT_PATH = Path("questions-data.js")
IMAGE_DIR = Path("assets/pdf-images")


def clean_text(value):
    value = value.replace("\u2019", "'").replace("\u00a0", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip(" -:\n\t")


def theme_for_number(number):
    ranges = [
        (1, 205, "Signalisation"),
        (206, 270, "Priorites et intersections"),
        (271, 359, "Croisement et depassement"),
        (360, 507, "Arret, stationnement et vitesse"),
        (508, 645, "Conduite, accidents et securite"),
        (646, 714, "Permis et documents"),
        (715, 930, "Mecanique et regles diverses"),
    ]
    for start, end, theme in ranges:
        if start <= number <= end:
            return theme
    return "Revision generale"


def parse_correct_letters(answer_text):
    letters = []
    for letter in re.findall(r"\b[a-e]\b", answer_text.lower()):
        if letter not in letters:
            letters.append(letter)
    return letters


def parse_chunk(chunk, page_number=None, media=None):
    header = re.match(r"\s*Questions?\s*(?:n\s*[°o]?\s*)?(\d+)\s*(.*)", chunk, re.I | re.S)
    if not header:
        return None

    number = int(header.group(1))
    body = clean_text(header.group(2))
    body = re.sub(r"^\d+\s+", "", body)

    response_match = re.search(r"\bR[ée]pons(?:e|es|s)?\s*:?\s*(.+)$", body, re.I | re.S)
    if not response_match:
        return None

    prompt_and_options = body[: response_match.start()]
    correct_letters = parse_correct_letters(response_match.group(1))
    option_matches = list(re.finditer(r"(?<!\w)(?:([a-e])\s*[\)-]|[-–]\s*([a-e])\b)", prompt_and_options, re.I))
    if not correct_letters:
        return None

    answers = []
    letters = []
    if option_matches:
        prompt = clean_text(prompt_and_options[: option_matches[0].start()])
        for index, match in enumerate(option_matches):
            start = match.end()
            end = option_matches[index + 1].start() if index + 1 < len(option_matches) else len(prompt_and_options)
            answer = clean_text(prompt_and_options[start:end])
            letter = (match.group(1) or match.group(2)).lower()
            letters.append(letter)
            answers.append(answer or f"Choix {letter.upper()}")
    else:
        tail = re.search(r"((?:\b[a-e]\b\s*){2,})$", prompt_and_options.strip(), re.I)
        loose_letters = []
        if tail:
            loose_letters = re.findall(r"\b[a-e]\b", tail.group(1).lower())
            prompt = clean_text(prompt_and_options[: tail.start()])
        else:
            prompt = clean_text(prompt_and_options)
        highest = max(2, max([ord(letter) for letter in correct_letters + loose_letters]) - ord("a"))
        letters = [chr(ord("a") + index) for index in range(highest + 1)]
        answers = [f"Choix {letter.upper()}" for letter in letters]

    letter_to_index = {letter: index for index, letter in enumerate(letters)}
    missing_letters = [letter for letter in correct_letters if letter not in letter_to_index]
    if missing_letters:
        highest = max(ord(letter) - ord("a") for letter in correct_letters)
        for index in range(len(letters), highest + 1):
            letter = chr(ord("a") + index)
            letters.append(letter)
            answers.append(f"Choix {letter.upper()}")
        letter_to_index = {letter: index for index, letter in enumerate(letters)}
    correct = [letter_to_index[letter] for letter in correct_letters if letter in letter_to_index]
    if not prompt or len(answers) < 2 or not correct:
        return None

    return {
        "number": number,
        "page": page_number,
        "theme": theme_for_number(number),
        "text": prompt,
        "answers": answers,
        "correct": correct,
        "explain": "Réponse du manuel: " + ", ".join(letter.upper() for letter in correct_letters) + ".",
        "media": media or [],
    }


def extract_page_images(reader, image_dir):
    image_dir.mkdir(parents=True, exist_ok=True)
    for old_file in image_dir.glob("*"):
        if old_file.is_file():
            old_file.unlink()

    page_media = defaultdict(list)
    seen = {}
    for page_number, page in enumerate(reader.pages, 1):
        try:
            images = list(page.images)
        except Exception:
            images = []

        for image_index, image in enumerate(images, 1):
            data = getattr(image, "data", b"")
            if len(data) < 700:
                continue

            original_name = getattr(image, "name", "") or f"image-{image_index}.png"
            suffix = Path(original_name).suffix.lower() or ".png"
            image_key = data[:64] + str(len(data)).encode()
            if image_key in seen:
                filename = seen[image_key]
            else:
                filename = f"page-{page_number:03d}-{image_index:02d}{suffix}"
                (image_dir / filename).write_bytes(data)
                seen[image_key] = filename

            page_media[page_number].append(f"assets/pdf-images/{filename}")

    return page_media


def main():
    source = PDF_PATH
    output = OUTPUT_PATH
    if len(sys.argv) > 1:
        source = Path(sys.argv[1])
    if len(sys.argv) > 2:
        output = Path(sys.argv[2])

    reader = pypdf.PdfReader(str(source))
    page_media = extract_page_images(reader, IMAGE_DIR)

    question_pages = {}
    for page_number, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        for match in re.finditer(r"Questions?\s*(?:n\s*[°o]?\s*)?(\d+)", text, re.I):
            question_pages.setdefault(int(match.group(1)), page_number)

    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    text = re.sub(r"[ \t]+", " ", text)
    chunks = re.split(r"(?=Questions?\s*(?:n\s*[°o]?\s*)?\d+)", text, flags=re.I)

    questions = []
    skipped = []
    seen = set()
    for chunk in chunks:
        number_match = re.match(r"\s*Questions?\s*(?:n\s*[°o]?\s*)?(\d+)", chunk, re.I)
        page_number = int(question_pages.get(int(number_match.group(1)), 0)) if number_match else None
        parsed = parse_chunk(chunk, page_number=page_number, media=page_media[page_number] if page_number else [])
        if not parsed:
            continue
        if parsed["number"] in seen:
            skipped.append(parsed["number"])
            continue
        seen.add(parsed["number"])
        questions.append(parsed)

    questions.sort(key=lambda item: item["number"])
    missing = [number for number in range(1, 931) if number not in seen]

    payload = {
        "source": source.name,
        "count": len(questions),
        "missing": missing,
        "questions": questions,
    }
    output.write_text(
        "window.PDF_QUESTION_BANK = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(f"extracted={len(questions)} missing={len(missing)} output={output}")
    if missing:
        print("missing_numbers=" + ",".join(map(str, missing)))


if __name__ == "__main__":
    main()
