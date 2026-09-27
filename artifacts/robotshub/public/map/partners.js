// Optimized copies of the originals in docs/prtners; no links or visible captions.
const partnerNames = [
  'Алабуга', 'Билайн', 'ВК тех', 'ГКМ', 'ГОЧС', 'ГПБ', 'Геоскан',
  'ДЖКХ', 'ДИТ', 'ДПИиР', 'ДФ', 'КМ Стройнадзор', 'КМ Экология',
  'ММ', 'МТ', 'ПТ', 'РСХБ', 'Ростелеком', 'ФЦ БАС', 'Фалькон', 'ЦДиТМ', 'ЯК',
];
const strip = document.querySelector('.partners-strip');
const track = strip.querySelector('.partners-track');
for (let copy = 0; copy < 2; copy++) {
  const group = document.createElement('div');
  group.className = 'partners-group';
  if (copy) group.setAttribute('aria-hidden', 'true');
  partnerNames.forEach((name, index) => {
    const slot = document.createElement('div');
    slot.className = 'partners-logo';
    const image = document.createElement('img');
    image.src = `../brand/partners/${String(index + 1).padStart(2, '0')}.webp`;
    image.alt = copy ? '' : name;
    image.decoding = 'async';
    image.draggable = false;
    slot.append(image);
    group.append(slot);
  });
  track.append(group);
}
const pause = strip.querySelector('.partners-pause');
pause.addEventListener('click', () => {
  const paused = strip.classList.toggle('is-paused');
  pause.setAttribute('aria-pressed', String(paused));
  pause.setAttribute('aria-label', paused ? 'Продолжить движение логотипов' : 'Приостановить движение логотипов');
  pause.textContent = paused ? '▶' : 'Ⅱ';
});