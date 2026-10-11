"""The lecture video of the deck's «Лекции» recording: slides.html shown slide by slide while an offline synthetic voice
reads lecture.md, joined by ffmpeg into one MP4 the site's «Аудио и видео» tab takes (MP4, up to 15 MB).

    <venv with piper-tts>/bin/python -I deck/cf11/tools/record/lecture/make.py <voice.onnx> <out dir> [--name lecture.mp4]
                                                                              [--length-scale 0.80]

1. lecture.md: one `##` block per slide, the paragraph under it is what the voice says on that slide.
2. render.cjs: each <section class="slide"> of slides.html → <out>/slides/sN.png (1280 × 720).
3. The voice (any Russian .onnx voice of piper-tts) reads each block with a short pause after every sentence;
   <out>/voice/sN.wav.
4. One sound track: a short lead-in, each slide's speech, a pause between slides (the next slide comes up during
   it, as a lecturer clicks before speaking). ffmpeg: H.264 1280 × 720, 25 fps (a key frame every 30 s: the slides
   stand still), BT.709; AAC mono 64 kbit/s,
   loudness -16 LUFS; +faststart.
Writes <out>/<name>, <out>/lecture.json (each slide's seconds, the words, the length and the size) and, for the
site's other ways in, the same lecture as a recording, <out>/<stem>.mp3 (64 kbit/s mono), and as slides,
<out>/slides.pdf (one slide a page).
"""
import json
import re
import subprocess
import sys
import wave
from pathlib import Path

from piper import PiperVoice
from piper.config import SynthesisConfig

HERE = Path(__file__).resolve().parent
LEAD = 0.8        # quiet before the first word, s
SENTENCE = 0.32   # quiet after each sentence, s
BETWEEN = 0.9     # quiet between two slides' speech, s
EARLY = 0.45      # the next slide comes up this long before its speech
TAIL = 1.6        # quiet after the last word, s
FPS = 25


def arg(name, default=None):
    if f'--{name}' in sys.argv:
        return sys.argv[sys.argv.index(f'--{name}') + 1]
    return default


def blocks(md_text):
    """[(title, narration)] from the `## N. Title` blocks of lecture.md."""
    out = []
    for part in re.split(r'^## ', md_text, flags=re.M)[1:]:
        head, _, body = part.partition('\n')
        title = re.sub(r'^\d+\.\s*', '', head.strip())
        text = ' '.join(line.strip() for line in body.strip().splitlines() if line.strip())
        out.append((title, text))
    return out


def speak(voice, text, path, config):
    """One slide's speech, sentence by sentence, with a pause after each; returns (sample rate, frames)."""
    with wave.open(str(path), 'wb') as wav:
        rate = None
        for chunk in voice.synthesize(text, syn_config=config):
            if rate is None:
                rate = chunk.sample_rate
                wav.setnchannels(chunk.sample_channels)
                wav.setsampwidth(chunk.sample_width)
                wav.setframerate(rate)
            wav.writeframes(chunk.audio_int16_bytes)
            wav.writeframes(b'\x00\x00' * int(rate * SENTENCE))
    with wave.open(str(path)) as w:
        return w.getframerate(), w.getnframes()


def main():
    voice_path, out = sys.argv[1], Path(sys.argv[2])
    name = arg('name', 'lecture.mp4')
    out.mkdir(parents=True, exist_ok=True)
    slides = blocks((HERE / 'lecture.md').read_text(encoding='utf-8'))

    # The slides as pictures.
    shots = out / 'slides'
    pdf = out / 'slides.pdf'
    subprocess.run(['node', str(HERE / 'render.cjs'), str(HERE / 'slides.html'), str(shots), '--pdf', str(pdf)], check=True,
                   stdout=subprocess.DEVNULL)
    pngs = sorted(shots.glob('s*.png'), key=lambda p: int(p.stem[1:]))
    if len(pngs) != len(slides):
        raise SystemExit(f'slides.html has {len(pngs)} slides, lecture.md {len(slides)} blocks')

    # The voice, slide by slide.
    voice = PiperVoice.load(voice_path)
    # 0.80: the voice reads at a lecturer's pace (about 120 words a minute; at 1.0 it reads about 100).
    config = SynthesisConfig(length_scale=float(arg('length-scale', 0.80)), noise_scale=0.6, noise_w_scale=0.8)
    vdir = out / 'voice'
    vdir.mkdir(exist_ok=True)
    parts = []
    for i, (title, text) in enumerate(slides, 1):
        rate, frames = speak(voice, text, vdir / f's{i}.wav', config)
        parts.append({'slide': i, 'title': title, 'words': len(text.split()), 'rate': rate, 'frames': frames})
        print(f'  s{i} {title}: {len(text.split())} words, {frames / rate:.1f} s')
    rate = parts[0]['rate']

    # One track: lead-in, speech, pauses; each slide comes up EARLY before its speech.
    track = out / 'track.wav'
    t = 0.0
    with wave.open(str(track), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)

        def quiet(seconds):
            w.writeframes(b'\x00\x00' * int(round(seconds * rate)))
            return int(round(seconds * rate)) / rate

        t += quiet(LEAD)
        for k, p in enumerate(parts):
            p['speech_from'] = round(t, 3)
            with wave.open(str(vdir / f's{p["slide"]}.wav')) as src:
                w.writeframes(src.readframes(src.getnframes()))
            t += p['frames'] / rate
            p['speech_to'] = round(t, 3)
            t += quiet(BETWEEN if k < len(parts) - 1 else TAIL)
    total = t
    for k, p in enumerate(parts):
        p['shown_from'] = 0.0 if k == 0 else round(p['speech_from'] - EARLY, 3)
    for k, p in enumerate(parts):
        p['shown_to'] = parts[k + 1]['shown_from'] if k + 1 < len(parts) else round(total, 3)

    # The video: each slide held for its time, the track under it.
    mp4 = out / name
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y']
    for p, png in zip(parts, pngs):
        cmd += ['-loop', '1', '-framerate', str(FPS), '-t', f'{p["shown_to"] - p["shown_from"]:.3f}', '-i', str(png)]
    cmd += ['-i', str(track)]
    n = len(parts)
    graph = (''.join(f'[{i}:v]' for i in range(n)) + f'concat=n={n}:v=1:a=0,'
             'scale=1280:720:flags=lanczos:out_color_matrix=bt709,format=yuv420p[v];'
             f'[{n}:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[a]')
    cmd += ['-filter_complex', graph, '-map', '[v]', '-map', '[a]',
            '-c:v', 'libx264', '-preset', 'slow', '-tune', 'stillimage', '-crf', '22', '-r', str(FPS), '-g', str(FPS * 30),
            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
            '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', '-shortest', str(mp4)]
    subprocess.run(cmd, check=True)

    # The same speech as a recording (the «Аудио и видео» tab takes MP3 too).
    mp3 = out / f'{Path(name).stem}.mp3'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(track), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
                    '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', str(mp3)], check=True)

    probe = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', str(mp4)],
                                      capture_output=True, text=True, check=True).stdout)['format']
    meta = {
        'file': name, 'seconds': round(float(probe['duration']), 2), 'bytes': int(probe['size']),
        'words': sum(p['words'] for p in parts), 'voice': Path(voice_path).name,
        'mp3': {'file': mp3.name, 'bytes': mp3.stat().st_size}, 'pdf': {'file': pdf.name, 'bytes': pdf.stat().st_size},
        'slides': [{k: p[k] for k in ('slide', 'title', 'words', 'shown_from', 'shown_to', 'speech_from', 'speech_to')} for p in parts],
    }
    (out / 'lecture.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{mp4}: {meta["seconds"]:.1f} s, {meta["bytes"] / 1e6:.2f} MB, {meta["words"]} words')


if __name__ == '__main__':
    main()
