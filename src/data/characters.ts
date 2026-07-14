import type { CharacterDefinition } from "../types";

export const characters: CharacterDefinition[] = [
  {
    id: "ninja",
    name: "Ninja",
    portraitUrl: "/game-assets/ui/character-select/fighter-ninja.webp",
    enabled: true,
    isDefault: true,
    unlockDescription: "Disponível desde o início",
    requiredPoints: 0,
    requiredDivision: "Autoprimata III",
  },
  {
    id: "itzcoatl",
    name: "Itzcoatl",
    portraitUrl: "/game-assets/ui/character-select/fighter-shaman.webp",
    enabled: true,
    isDefault: true,
    unlockDescription: "Disponível desde o início",
    requiredPoints: 0,
    requiredDivision: "Autoprimata III",
  },
  {
    id: "aton",
    name: "Aton",
    portraitUrl: "/game-assets/ui/character-select/fighter-urban.webp",
    enabled: true,
    isDefault: true,
    unlockDescription: "Disponível desde o início",
    requiredPoints: 0,
    requiredDivision: "Autoprimata III",
  },
  {
    id: "doll",
    name: "Doll.exe",
    portraitUrl: "/game-assets/ui/character-select/fighter-doll.png",
    enabled: true,
    isDefault: true,
    unlockDescription: "Disponível desde o início",
    requiredPoints: 0,
    requiredDivision: "Autoprimata III",
  },
  {
    id: "coming-soon",
    name: "Em breve",
    portraitUrl: "/game-assets/ui/character-select/fighter-coming-soon-face-question.webp",
    enabled: false,
    isDefault: false,
    unlockDescription: "Personagem futuro por ranking",
    requiredPoints: 800,
    requiredDivision: "Prata III",
  },
];

export function characterById(id: string): CharacterDefinition {
  return characters.find((character) => character.id === id) || characters[0];
}

export function defaultCharacterIds(): string[] {
  return characters.filter((character) => character.enabled && character.isDefault).map((character) => character.id);
}
