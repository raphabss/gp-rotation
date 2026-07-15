// Mapa de cores por (marca + mesa) para a TV de Rotacao.
// Regras de cor:
//  - Cor FIXA por mesa quando conhecida (fiel aos prints da planilha).
//  - Mesa SEM cor fixa: recebe uma cor DETERMINISTICA da paleta da propria
//    marca (ex.: qualquer mesa CDA usa as cores da 1a tabela CDA, ciclando).
//    Assim nenhuma mesa real cai no cinza -> nunca sabe some no fundo dark.
//  - Marca DESCONHECIDA (planilha sem titulo CDA/BLAZE/etc.): usa uma paleta
//    generica viva, escolhida para alto contraste no fundo escuro.
//  - CINZA fica reservado APENAS para 'B' (break).
//  - Cor do texto (claro/escuro) calculada pela luminancia do fundo.
(function(global){
  var TABLE_COLORS = {
    CDA: {
      '6130':'#f5e7a3', '6131':'#f4c7c7', '6132':'#a9d8a0', '6133':'#e8706c',
      '6134':'#f2f2f2', '6150':'#d8b24e', 'B':'#6f6f6f'
    },
    BLAZE: {
      '6140':'#3b4047', '6141':'#7d1f1f', '6142':'#9a9a9a', '6143':'#ff2d2d',
      '6144':'#efefef', '6150':'#d8b24e', 'B':'#b53636'
    },
    Shufflers: {
      'ALL':'#e8b8e0', 'B':'#e3998a'
    }
  };

  // Paletas de PREENCHIMENTO para mesas sem cor fixa. Todas claras/saturadas
  // o suficiente para leitura confortavel no fundo dark.
  var BRAND_PALETTES = {
    CDA:            ['#f5e7a3','#f4c7c7','#a9d8a0','#e8706c','#f2f2f2','#d8b24e'],
    BLAZE:          ['#ff2d2d','#efefef','#f2a0a0','#e0743a','#e8b923','#ff8f5c'],
    'Sports Club':  ['#e8d6a0','#a9c58f','#e2e2df','#cbb27a','#f0a35a','#bcd0a0'],
    Shufflers:      ['#e8b8e0','#c9a3f0','#f0b8d0','#b8c8f0']
  };
  // Paleta generica para marcas desconhecidas — cores vivas e distintas.
  var GENERIC_PALETTE = [
    '#f5e7a3','#a9d8a0','#8ec5ff','#f4a3d2','#ffb27a','#c3a3f5',
    '#8fe0c8','#e8706c','#d8b24e','#9ad0f5','#b6e07a','#ef9ad6'
  ];

  var DEFAULT = { B:'#33414f', ALL:'#e8b8e0', X:'#1a212c' };

  // Luminancia relativa -> decide texto claro/escuro
  function textColor(hex){
    var c = hex.replace('#',''); if(c.length===3){c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];}
    var r=parseInt(c.substr(0,2),16)/255, g=parseInt(c.substr(2,2),16)/255, b=parseInt(c.substr(4,2),16)/255;
    var f=function(v){return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    var L=0.2126*f(r)+0.7152*f(g)+0.0722*f(b);
    return L>0.45 ? '#15181d' : '#f5f7fa';   // fundo claro->texto escuro; escuro->claro
  }

  // Indice estavel a partir do identificador da mesa (ex.: "6115" -> numero).
  // Mesmas mesas sempre recebem a mesma cor, independente da posicao/tabela.
  function paletteIndex(key, len){
    var s = String(key==null?'':key);
    var digits = s.replace(/\D/g,'');
    var n;
    if(digits){ n = parseInt(digits,10); }
    else { n=0; for(var i=0;i<s.length;i++){ n=(n*31 + s.charCodeAt(i))>>>0; } }
    return n % len;
  }

  // Cor de fundo de uma mesa, com fallback deterministico e SEMPRE visivel.
  function tableColor(brand, table){
    var map = TABLE_COLORS[brand] || {};
    if(map[table]) return map[table];                 // cor fixa conhecida
    var pal = BRAND_PALETTES[brand] || GENERIC_PALETTE;
    return pal[ paletteIndex(table, pal.length) ];     // fallback legivel
  }

  // Retorna {bg, fg} para uma celula de uma marca
  function cellColor(brand, cell){
    if(!cell) return null;
    var map = TABLE_COLORS[brand] || {};
    var bg = null;
    if(cell.type==='table')        bg = tableColor(brand, cell.table);
    else if(cell.type==='tables')  bg = tableColor(brand, (cell.tables && cell.tables[0]));
    else if(cell.type==='break')   bg = map['B'] || DEFAULT.B;
    else if(cell.type==='all')     bg = map['ALL'] || DEFAULT.ALL;
    else if(cell.type==='todo')    return { bg:'transparent', fg:'#e6a23c' };
    else if(cell.type==='off')     return { bg:'transparent', fg:'#3a4658' };
    else return null;
    return { bg: bg, fg: textColor(bg) };
  }

  global.GP_COLORS = {
    cellColor: cellColor, textColor: textColor, tableColor: tableColor,
    TABLE_COLORS: TABLE_COLORS, BRAND_PALETTES: BRAND_PALETTES, GENERIC_PALETTE: GENERIC_PALETTE
  };
})(typeof window!=='undefined'?window:this);
