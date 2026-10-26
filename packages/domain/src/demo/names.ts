/** Invented-person name pools (Latin transliteration as in passports). */

export const namePools = {
  UA: {
    male: ["Andrii", "Oleh", "Serhii", "Vasyl", "Mykola", "Dmytro", "Bohdan", "Taras", "Roman", "Yurii", "Ivan", "Petro", "Maksym", "Volodymyr", "Oleksandr", "Viktor", "Artem", "Denys", "Ihor", "Pavlo"],
    female: ["Olena", "Oksana", "Iryna", "Natalia", "Halyna", "Yulia", "Tetiana", "Svitlana", "Mariia", "Kateryna", "Liudmyla", "Anastasiia", "Viktoriia", "Nadiia", "Larysa"],
    last: ["Melnyk", "Shevchenko", "Bondar", "Kovalenko", "Tkachenko", "Kravets", "Moroz", "Savchuk", "Lysenko", "Rudenko", "Polishchuk", "Hrytsenko", "Lytvyn", "Ivanenko", "Marchenko", "Boiko", "Kravchenko", "Oliinyk", "Pavlenko", "Hnatiuk", "Klymenko", "Tymoshchuk", "Sydorenko", "Yarema", "Fedoriv"],
  },
  PL: {
    male: ["Tomasz", "Piotr", "Marek", "Jakub", "Paweł", "Krzysztof", "Michał", "Łukasz", "Adam", "Kamil", "Grzegorz", "Wojciech"],
    female: ["Anna", "Katarzyna", "Agnieszka", "Ewa", "Joanna", "Magdalena", "Monika", "Aleksandra", "Natalia", "Karolina"],
    lastMale: ["Kowalski", "Wiśniewski", "Majewski", "Zieliński", "Lewandowski", "Kamiński", "Dąbrowski", "Nowicki", "Mazur", "Kaczmarek", "Krawczyk", "Wójcik", "Pawlak", "Sikora"],
    lastFemale: ["Kowalska", "Wiśniewska", "Majewska", "Zielińska", "Lewandowska", "Kamińska", "Dąbrowska", "Nowicka", "Mazur", "Kaczmarek", "Krawczyk", "Wójcik", "Pawlak", "Sikora"],
  },
  BY: {
    male: ["Aliaksandr", "Siarhei", "Dzmitry", "Andrei", "Pavel", "Uladzimir"],
    female: ["Volha", "Hanna", "Tatsiana", "Aksana", "Iryna"],
    last: ["Kavalchuk", "Novik", "Karpovich", "Zhuk", "Kazlou", "Sidarenka"],
  },
  GE: {
    male: ["Giorgi", "Levan", "Davit", "Irakli", "Nika"],
    female: ["Nino", "Tamar", "Mariam", "Ana"],
    last: ["Beridze", "Kapanadze", "Gelashvili", "Maisuradze", "Lomidze"],
  },
  MD: {
    male: ["Ion", "Vasile", "Andrei", "Mihai"],
    female: ["Maria", "Elena", "Ana", "Cristina"],
    last: ["Rusu", "Ceban", "Ciobanu", "Lungu", "Munteanu"],
  },
} as const;
