import type { Competence, Position, Reason } from "../types";

export const competences: Competence[] = [
  { id: "c-wms", name: { pl: "Skaner WMS", uk: "Сканер WMS", ru: "Сканер WMS", en: "WMS scanner" }, requiresDocument: false },
  { id: "c-udt", name: { pl: "Wózek widłowy UDT", uk: "Навантажувач UDT", ru: "Погрузчик UDT", en: "Forklift (UDT)" }, requiresDocument: true },
  { id: "c-qc", name: { pl: "Kontrola jakości", uk: "Контроль якості", ru: "Контроль качества", en: "Quality control" }, requiresDocument: false },
  { id: "c-pl-a2", name: { pl: "Polski A2+", uk: "Польська A2+", ru: "Польский A2+", en: "Polish A2+" }, requiresDocument: false },
  { id: "c-de-a2", name: { pl: "Niemiecki A2", uk: "Німецька A2", ru: "Немецкий A2", en: "German A2" }, requiresDocument: false },
  { id: "c-height", name: { pl: "Praca na wysokości", uk: "Робота на висоті", ru: "Работа на высоте", en: "Work at height" }, requiresDocument: true },
];

export const positions: Position[] = [
  { id: "p-picker", name: { pl: "Kompletujący", uk: "Комплектувальник", ru: "Комплектовщик", en: "Picker" }, competenceIds: ["c-wms"] },
  { id: "p-forklift", name: { pl: "Operator wózka widłowego", uk: "Оператор навантажувача", ru: "Оператор погрузчика", en: "Forklift operator" }, competenceIds: ["c-udt"] },
  { id: "p-qc", name: { pl: "Kontroler jakości", uk: "Контролер якості", ru: "Контролёр качества", en: "Quality controller" }, competenceIds: ["c-qc"] },
  { id: "p-packer", name: { pl: "Pakowacz", uk: "Пакувальник", ru: "Упаковщик", en: "Packer" }, competenceIds: [] },
  { id: "p-sorter", name: { pl: "Sortujący", uk: "Сортувальник", ru: "Сортировщик", en: "Sorter" }, competenceIds: [] },
  { id: "p-line", name: { pl: "Operator linii", uk: "Оператор лінії", ru: "Оператор линии", en: "Line operator" }, competenceIds: [] },
  { id: "p-storekeeper", name: { pl: "Magazynier", uk: "Комірник", ru: "Кладовщик", en: "Storekeeper" }, competenceIds: ["c-wms"] },
];

/** Tenant dictionary of timesheet correction reasons (9.2-21). */
export const correctionReasons: Reason[] = [
  { id: "r-ot-unapproved", code: "ot-unapproved", name: { pl: "Nadgodziny nieuzgodnione", uk: "Понаднормові не погоджені", ru: "Сверхурочные не согласованы", en: "Overtime not approved" } },
  { id: "r-clock-error", code: "clock-error", name: { pl: "Błąd odbicia", uk: "Помилка відмітки", ru: "Ошибка отметки", en: "Clock-in error" } },
  { id: "r-client-task", code: "client-task", name: { pl: "Praca poza zmianą na zlecenie klienta", uk: "Робота поза зміною на завдання клієнта", ru: "Работа вне смены по заданию клиента", en: "Off-shift work requested by client" } },
  { id: "r-forgot", code: "forgot", name: { pl: "Pracownik zapomniał się odbić", uk: "Працівник забув відмітитися", ru: "Работник забыл отметиться", en: "Worker forgot to clock" } },
  { id: "r-dispute", code: "dispute", name: { pl: "Uzgodnione w sporze z klientem", uk: "Погоджено за спором клієнта", ru: "Согласовано по спору клиента", en: "Agreed in client dispute" } },
  { id: "r-absence-excused", code: "absence-excused", name: { pl: "Nieobecność usprawiedliwiona", uk: "Відсутність з поважної причини", ru: "Отсутствие по уважительной причине", en: "Excused absence" } },
];

/** Tenant dictionary of client dispute reasons (12.2-10). */
export const disputeReasons: Reason[] = [
  { id: "d-was-onsite", code: "was-onsite", name: { pl: "Pracownik był na obiekcie", uk: "Працівник був на об'єкті", ru: "Работник был на объекте", en: "Worker was on site" } },
  { id: "d-too-many", code: "too-many", name: { pl: "Godzin więcej niż faktycznie", uk: "Годин більше, ніж фактично", ru: "Часов больше, чем фактически", en: "More hours than worked" } },
  { id: "d-not-ours", code: "not-ours", name: { pl: "Pracownik spoza naszego zamówienia", uk: "Працівник не з нашої заявки", ru: "Работник не нашей заявки", en: "Worker not on our request" } },
  { id: "d-other", code: "other", name: { pl: "Inne", uk: "Інше", ru: "Другое", en: "Other" } },
];
