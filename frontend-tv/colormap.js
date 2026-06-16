// Mapa de cores por (marca + mesa), fiel aos prints da planilha.
// O texto é calculado automaticamente conforme a luminância do fundo.
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
  var DEFAULT = { table:'#2a3340', B:'#33414f', ALL:'#e8b8e0', X:'#1a212c' };

  // Luminância relativa -> decide texto claro/escuro
  function textColor(hex){
    var c = hex.replace('#',''); if(c.length===3){c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];}
    var r=parseInt(c.substr(0,2),16)/255, g=parseInt(c.substr(2,2),16)/255, b=parseInt(c.substr(4,2),16)/255;
    var f=function(v){return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    var L=0.2126*f(r)+0.7152*f(g)+0.0722*f(b);
    return L>0.45 ? '#15181d' : '#f5f7fa';   // fundo claro->texto escuro; escuro->claro
  }

  // Retorna {bg, fg} para uma célula de uma marca
  function cellColor(brand, cell){
    if(!cell) return null;
    var map = TABLE_COLORS[brand] || {};
    var bg = null;
    if(cell.type==='table') bg = map[cell.table] || DEFAULT.table;
    else if(cell.type==='break') bg = map['B'] || DEFAULT.B;
    else if(cell.type==='all') bg = map['ALL'] || DEFAULT.ALL;
    else if(cell.type==='off') return { bg:'transparent', fg:'#3a4658' };
    else return null;
    return { bg: bg, fg: textColor(bg) };
  }

  global.GP_COLORS = { cellColor: cellColor, textColor: textColor, TABLE_COLORS: TABLE_COLORS };
})(window);
