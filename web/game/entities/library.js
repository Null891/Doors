// library.js — the Door 50 puzzle. Books show a shape+digit when read; the
// paper shows which shape maps to each Roman numeral I-V; the 5-digit
// padlock code is those digits in numeral order. Assigns 5 distinct shapes
// to 5 real books FIRST (shuffled) so the paper's hints are always solvable
// — extra books are flavor/red herrings and may repeat.

import { randInt, choice } from '../utils.js';
import { Sfx } from '../audio.js';

const SHAPES = ['Hexagon', 'Star', 'Diamond', 'Circle', 'Triangle', 'Square', 'Cross', 'Moon'];
const NUMERALS = ['I', 'II', 'III', 'IV', 'V'];

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function initLibrary(room, ctx, figureInstance) {
  if (!room.libraryBooks || !room.libraryPaper) return;

  const shapePool = shuffled(SHAPES);
  const bookOrder = shuffled(room.libraryBooks);
  bookOrder.forEach((book, i) => {
    const shape = i < 5 ? shapePool[i] : choice(SHAPES);
    book.data = { shape, digit: randInt(0, 9) };
    book._read = false;
  });

  const solutionShapes = shapePool.slice(0, 5);
  let solutionCode = '';
  for (const shape of solutionShapes) {
    const match = room.libraryBooks.find((b) => b.data.shape === shape);
    solutionCode += String(match.data.digit);
  }

  for (const book of room.libraryBooks) {
    room.interactables.push({
      pos: book.promptPos, range: 4,
      getLabel: () => `Read Book (${book.data.shape})`,
      interact: (ictx) => {
        Sfx.bookFlip();
        ictx.hud.caption(`${book.data.shape}: ${book.data.digit}`);
        if (!book._read) {
          book._read = true;
          ictx.game.onLibraryBookRead();
        }
      },
    });
  }

  room.interactables.push({
    pos: room.libraryPaper.promptPos, range: 4,
    getLabel: () => 'Read Paper',
    interact: (ictx) => {
      const lines = NUMERALS.map((numeral, i) => `${numeral} — ${solutionShapes[i]}`).join('<br>');
      ictx.hud.paperShow(`<div>${lines}</div>`);
    },
  });

  const doorInteractable = room.interactables.find((i) => i.isExitDoor);
  if (doorInteractable) {
    doorInteractable.getLabel = () => (room.exitDoor.opened ? null : 'Enter Code');
    doorInteractable.interact = (ictx) => {
      if (room.exitDoor.opened) return;
      ictx.hud.padlockOpen((code) => {
        if (code === solutionCode) {
          ictx.hud.padlockClose();
          ictx.world.forceUnlock(room);
          ictx.game.tryOpenDoor(room.exitDoor, room);
        } else {
          ictx.hud.padlockMsg('Incorrect combination.');
          Sfx.uiClick();
        }
      });
    };
  }

  if (figureInstance) figureInstance.activate(room, ctx);
}
