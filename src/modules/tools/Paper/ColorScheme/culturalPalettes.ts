export interface CulturalPalette {
  id: string;
  colors: string[];
}

export interface CultureGroup {
  id: string;
  palettes: CulturalPalette[];
}

export const culturalPalettes: CultureGroup[] = [
  {
    id: 'huizhou',
    palettes: [
      // 深炭蓝 → 山青 → 烟绿 → 砚台石 → 宣纸
      { id: 'huizhou_ink',     colors: ['#1E2D38', '#3D6068', '#7FA5A0', '#C8C4B4', '#F0EDDE'] },
      // 深黛蓝 → 石板灰 → 月白 → 浅灰白 → 粉白
      { id: 'huizhou_village', colors: ['#28384A', '#485C72', '#8298AA', '#C8C8C4', '#F2F0EA'] },
      // 深松绿 → 林绿 → 山岚绿 → 暖石 → 沙土
      { id: 'huizhou_xin_an',  colors: ['#285442', '#4A7A60', '#8AAA92', '#C0A87A', '#EAE0C8'] },
    ],
  },
  {
    id: 'forbidden_city',
    palettes: [
      // 深朱砂 → 赤褐 → 琥珀 → 淡金 → 象牙
      { id: 'fc_vermilion', colors: ['#6A2828', '#A05040', '#C07838', '#D4B060', '#F0E8D4'] },
      // 藏蓝 → 帝青 → 天青 → 金黄 → 羊皮纸
      { id: 'fc_imperial',  colors: ['#1C3858', '#305C8C', '#5888B4', '#A89040', '#EAE4D4'] },
      // 深翠 → 宫苔绿 → 玉绿 → 铜褐 → 米白
      { id: 'fc_jade',      colors: ['#263E30', '#406050', '#6A9070', '#A08048', '#EAE5D8'] },
    ],
  },
  {
    id: 'dunhuang',
    palettes: [
      // 赭红 → 陶红 → 矿金 → 石青 → 暖沙
      { id: 'dh_apsaras', colors: ['#703020', '#A85838', '#C09030', '#507090', '#EAD8B4'] },
      // 深棕 → 中棕 → 暖褐 → 风化灰绿 → 陈年纸
      { id: 'dh_grotto',  colors: ['#382010', '#684830', '#A07850', '#789080', '#DECDB0'] },
      // 深水蓝 → 绿洲青 → 浅碧 → 沙金 → 沙漠沙
      { id: 'dh_oasis',   colors: ['#243850', '#386878', '#6898A0', '#B09038', '#E0D4A8'] },
    ],
  },
  {
    id: 'tibet',
    palettes: [
      // 寺庙深红 → 陶红 → 藏红花黄 → 高原天蓝 → 雪白
      { id: 'tb_potala',  colors: ['#5C2428', '#8A4038', '#B07828', '#6088A8', '#E8E4DC'] },
      // 深夜钴蓝 → 高原蓝 → 天际蓝 → 冰川灰 → 积雪白
      { id: 'tb_sky',     colors: ['#1A3468', '#305898', '#6090C0', '#A8B8C0', '#E8ECF0'] },
      // 深青金石 → 中青金石 → 天空青 → 贴金 → 唐卡布底
      { id: 'tb_thangka', colors: ['#1C2848', '#2E4878', '#5880A0', '#C09838', '#E8DCC8'] },
    ],
  },
  {
    id: 'mongolia',
    palettes: [
      // 深夜蓝 → 高远蓝 → 苍天蓝 → 黄土 → 苍茫白
      { id: 'mg_sky',       colors: ['#1C3858', '#2E5E98', '#6898C8', '#A09060', '#EAE8E0'] },
      // 深草绿 → 草原绿 → 嫩草 → 枯草黄 → 地平线白
      { id: 'mg_grassland', colors: ['#1E4028', '#387048', '#68A070', '#B0B880', '#E8EEE0'] },
      // 深炭 → 黄土 → 骆驼棕 → 奶茶 → 毡白
      { id: 'mg_campfire',  colors: ['#3C2010', '#705030', '#A07840', '#D0B880', '#F0E8D8'] },
    ],
  },
  {
    id: 'lingnan',
    palettes: [
      // 青砖深 → 石绿灰 → 釉绿 → 浅瓦绿 → 灰白
      { id: 'ln_architecture', colors: ['#2A3838', '#486060', '#789080', '#C0C4B0', '#EAEEEA'] },
      // 深红棉红 → 砖红 → 琥珀棕 → 淡金 → 象牙
      { id: 'ln_kapok',        colors: ['#602828', '#9A5038', '#C09050', '#D8C080', '#F2ECD8'] },
      // 珠江深蓝 → 水蓝 → 浅碧 → 苇绿 → 水雾白
      { id: 'ln_pearl_river',  colors: ['#1C3A48', '#305870', '#5A8898', '#A8B8A8', '#E8F0EC'] },
    ],
  },
];
