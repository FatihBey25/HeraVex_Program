const fs = require('fs');

let c = fs.readFileSync('c:/tauri_hubUltra/src/App.tsx', 'utf-8');

// Fix the copy object for all languages by matching the keys and putting back string literals
const newKeysEN = {
  wFetchingRates: "⏳ Updating rates...",
  wActiveCurrencies: "Active Currencies",
  wClose: "Close",
  wAddCurrency: "+ Add Currency",
  wAddAction: "Add",
  wTabGeneral: "📋 General Expenses",
  wTabProjects: "🎮 Project Expenses",
  wFinSummary: "Financial Summary",
  wTotalAllPlain: "ALL PROJECTS + GENERAL TOTAL",
  wExportCSVPlain: "Export CSV",
  wGeneralStudioExp: "GENERAL STUDIO EXPENSES",
  wGeneralStudioDesc: "Office, Hardware, Licensing",
  wGeneralStudioSub: "Fixed costs not related to games",
  wNoExpensesYet: "No expenses added yet.",
  wProjectExpEyebrow: "PROJECT BASED EXPENSES",
  wNoBudgetLimit: "No budget limit",
  wExpenseFor: "Add Expense for",
  wAddToProject: "Add to Project",
  wNoProjectsYet: "No projects yet. Create a project first.",
  wRatesUpdated: "Exchange rates updated",
  wExpenseDeleted: "Expense deleted",
  wGeneralExpenseDeleted: "General expense deleted"
};

const newKeysTR = {
  wFetchingRates: "⏳ Kurlar güncelleniyor...",
  wActiveCurrencies: "Aktif Dövizler",
  wClose: "Kapat",
  wAddCurrency: "+ Döviz Ekle",
  wAddAction: "Ekle",
  wTabGeneral: "📋 Genel Giderler",
  wTabProjects: "🎮 Proje Giderleri",
  wFinSummary: "Finansal Özet",
  wTotalAllPlain: "TÜM PROJELER + GENEL TOPLAM",
  wExportCSVPlain: "CSV Dışa Aktar",
  wGeneralStudioExp: "GENEL STÜDYO GİDERLERİ",
  wGeneralStudioDesc: "Ofis, Donanım, Lisanslama",
  wGeneralStudioSub: "Oyunlara bağlı olmayan sabit giderler",
  wNoExpensesYet: "Henüz eklenmiş gider yok.",
  wProjectExpEyebrow: "PROJE BAZLI GİDERLER",
  wNoBudgetLimit: "Bütçe sınırı yok",
  wExpenseFor: "İçin Gider Ekle",
  wAddToProject: "Projeye Ekle",
  wNoProjectsYet: "Henüz proje yok. Önce bir proje oluşturun.",
  wRatesUpdated: "Kurlar güncellendi",
  wExpenseDeleted: "Gider silindi",
  wGeneralExpenseDeleted: "Genel gider silindi"
};

const newKeysFR = {
  wFetchingRates: "⏳ Mise à jour des taux...",
  wActiveCurrencies: "Devises Actives",
  wClose: "Fermer",
  wAddCurrency: "+ Ajouter Devise",
  wAddAction: "Ajouter",
  wTabGeneral: "📋 Dépenses Générales",
  wTabProjects: "🎮 Dépenses de Projet",
  wFinSummary: "Résumé Financier",
  wTotalAllPlain: "TOUS LES PROJETS + TOTAL GÉNÉRAL",
  wExportCSVPlain: "Exporter CSV",
  wGeneralStudioExp: "DÉPENSES GÉNÉRALES DU STUDIO",
  wGeneralStudioDesc: "Bureau, Matériel, Licences",
  wGeneralStudioSub: "Coûts fixes non liés aux jeux",
  wNoExpensesYet: "Aucune dépense ajoutée.",
  wProjectExpEyebrow: "DÉPENSES PAR PROJET",
  wNoBudgetLimit: "Pas de limite de budget",
  wExpenseFor: "Ajouter dépense pour",
  wAddToProject: "Ajouter au Projet",
  wNoProjectsYet: "Aucun projet. Créez un projet d'abord.",
  wRatesUpdated: "Taux de change mis à jour",
  wExpenseDeleted: "Dépense supprimée",
  wGeneralExpenseDeleted: "Dépense générale supprimée"
};

const newKeysES = {
  wFetchingRates: "⏳ Actualizando tasas...",
  wActiveCurrencies: "Monedas Activas",
  wClose: "Cerrar",
  wAddCurrency: "+ Añadir Moneda",
  wAddAction: "Añadir",
  wTabGeneral: "📋 Gastos Generales",
  wTabProjects: "🎮 Gastos de Proyecto",
  wFinSummary: "Resumen Financiero",
  wTotalAllPlain: "TODOS LOS PROYECTOS + TOTAL GENERAL",
  wExportCSVPlain: "Exportar CSV",
  wGeneralStudioExp: "GASTOS GENERALES DEL ESTUDIO",
  wGeneralStudioDesc: "Oficina, Hardware, Licencias",
  wGeneralStudioSub: "Costos fijos no relacionados con juegos",
  wNoExpensesYet: "Aún no se añadieron gastos.",
  wProjectExpEyebrow: "GASTOS POR PROYECTO",
  wNoBudgetLimit: "Sin límite de presupuesto",
  wExpenseFor: "Añadir gasto para",
  wAddToProject: "Añadir al Proyecto",
  wNoProjectsYet: "Aún no hay proyectos. Crea uno primero.",
  wRatesUpdated: "Tasas de cambio actualizadas",
  wExpenseDeleted: "Gasto eliminado",
  wGeneralExpenseDeleted: "Gasto general eliminado"
};

function fixSection(startKey, obj) {
  let start = c.indexOf(startKey);
  if(start === -1) return;
  for (const [k, v] of Object.entries(obj)) {
    const regex1 = new RegExp(k + ':\\s*ui\\.' + k, 'g');
    c = c.replace(regex1, k + ': "' + v + '"');
    const regex2 = new RegExp(k + ':\\s*"\\{ui\\.' + k + '\\}"', 'g');
    c = c.replace(regex2, k + ': "' + v + '"');
    const regex3 = new RegExp(k + ':\\s*"\\" \\" \\+ ui\\.' + k + '"', 'g');
    c = c.replace(regex3, k + ': "' + v + '"');
    const regex4 = new RegExp(k + ':\\s*"\\" \\" \\+ ui\\.wExpenseFor"', 'g');
    c = c.replace(regex4, k + ': "' + v + '"');
  }
}

fixSection('en: {', newKeysEN);
fixSection('tr: {', newKeysTR);
fixSection('fr: {', newKeysFR);
fixSection('es: {', newKeysES);

// Replace any remaining rogue lines where my regex failed, just blanket replace them in copy object
const parts = c.split('export default function App()');
let copyObj = parts[0];
let reactComp = parts[1];

for (const [k, v] of Object.entries(newKeysTR)) {
  copyObj = copyObj.split(k + ': " " + ui.wExpenseFor').join(k + ': "' + v + '"');
}

c = copyObj + 'export default function App()' + reactComp;

fs.writeFileSync('c:/tauri_hubUltra/src/App.tsx', c);
