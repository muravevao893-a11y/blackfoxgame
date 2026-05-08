import dotenv from 'dotenv';
import { Telegraf, Markup } from 'telegraf';
import express from 'express';
import { initDb, pool, requireUser, logTx } from './db.mjs';

dotenv.config();
const BOT_NAME = 'BlackFox Game';
const CURRENCY = 'Фоксы';
const GEM = 'Кристаллы';
const bot = new Telegraf(process.env.BOT_TOKEN);
const adminIds = new Set((process.env.ADMIN_IDS || '').split(',').map(x => Number(x.trim())).filter(Boolean));
const localSpam = new Map();

const ranks = ['Новичок','Игрок','Дилер','Магнат','Барон','Олигарх','Легенда','Император','Черный Лис'];
const cases = [
  { id:1, key:'case_1', title:'Лисий кейс', price:25000, min:15000, max:90000, gems:1, gemChance:.08, jackpot:.015 },
  { id:2, key:'case_2', title:'Неоновый кейс', price:120000, min:90000, max:380000, gems:3, gemChance:.18, jackpot:.035 },
  { id:3, key:'case_3', title:'Королевский кейс', price:600000, min:450000, max:1800000, gems:8, gemChance:.35, jackpot:.06 },
  { id:4, key:'case_4', title:'BlackFox кейс', price:2500000, min:1500000, max:8500000, gems:25, gemChance:.55, jackpot:.09 }
];
const facilities = {
  business:{ title:'Бизнес', icon:'🗄', build:'построить бизнес', aliases:['бизнес','мой бизнес'], price:350000, income:65000, interval:6 },
  generator:{ title:'Генератор', icon:'🏭', build:'построить генератор', aliases:['генератор','мой генератор'], price:750000, income:145000, interval:6 },
  farm:{ title:'Майнинг ферма', icon:'🔋', build:'построить ферму', aliases:['ферма','моя ферма','майнинг ферма'], price:1400000, income:3000, interval:1 },
  quarry:{ title:'Карьер', icon:'⚠️', build:'построить карьер', aliases:['карьер','мой карьер'], price:2800000, income:720000, interval:10 },
  tree:{ title:'Денежное дерево', icon:'🌳', build:'построить участок', aliases:['денежное дерево','моё дерево','мое дерево'], price:500000, income:90000, interval:4 },
  garden:{ title:'Сад', icon:'🪧', build:'построить сад', aliases:['сад','мой сад'], price:900000, income:120000, interval:6 }
};
const potions = [
  { id:1, key:'potion_luck', title:'Зелье удачи', cost:3, text:'+шанс джекпота в кейсах на 2 часа' },
  { id:2, key:'potion_income', title:'Зелье дохода', cost:5, text:'+25% к доходу построек на 2 часа' },
  { id:3, key:'potion_azart', title:'Зелье азарта', cost:7, text:'+3 заряда удачи' }
];

const m = v => `${Number(v || 0).toLocaleString('ru-RU')} ${CURRENCY}`;
const g = v => `${Number(v || 0).toLocaleString('ru-RU')} ${GEM}`;
const cash = v => `${Number(v || 0).toLocaleString('ru-RU').replace(/\u00a0/g,'.').replace(/ /g,'.')}$`;
const rnd = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const now = () => new Date();
function rank(level){ return ranks[Math.min(ranks.length-1, Math.floor((Number(level)-1)/5))]; }
function parseAmount(raw, user){ const s=String(raw||'').toLowerCase().trim(); if(['все','all','вабанк'].includes(s)) return Math.floor(Number(user.foxes)); if(['половина','пол','half'].includes(s)) return Math.floor(Number(user.foxes)/2); const n=Number(s.replace(/\s/g,'')); return Number.isFinite(n)?Math.floor(n):NaN; }
async function admin(ctx){
  const tgId = ctx.from?.id;
  if (!tgId) return false;
  if (adminIds.has(tgId)) return true;
  try {
    const r = await pool.query('SELECT is_admin FROM users WHERE tg_id=$1 LIMIT 1', [tgId]);
    return r.rows[0]?.is_admin === true;
  } catch {
    return false;
  }
}
async function logAdmin(ctx, action, targetTgId=null, amount=0, meta=''){
  await pool.query('INSERT INTO admin_actions(admin_tg_id,target_tg_id,action,amount,meta) VALUES($1,$2,$3,$4,$5)', [ctx.from?.id || null, targetTgId, action, amount, meta]).catch(()=>{});
}
async function getUserByAny(raw){ const s=String(raw||'').replace('@','').trim(); if(/^\d+$/.test(s)){ const r=await pool.query('SELECT * FROM users WHERE tg_id=$1 OR id=$1',[Number(s)]); return r.rows[0]; } const r=await pool.query('SELECT * FROM users WHERE LOWER(username)=LOWER($1)',[s]); return r.rows[0]; }
async function addItem(userId,key,title,amount=1,meta={}){ await pool.query(`INSERT INTO inventory_items(user_id,item_key,title,amount,meta) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,item_key) DO UPDATE SET amount=inventory_items.amount+EXCLUDED.amount,title=EXCLUDED.title`,[userId,key,title,amount,JSON.stringify(meta)]); }
async function takeItem(userId,key,amount=1){ const r=await pool.query('UPDATE inventory_items SET amount=amount-$1 WHERE user_id=$2 AND item_key=$3 AND amount>=$1 RETURNING *',[amount,userId,key]); return !!r.rows[0]; }
async function addXp(userId, amount){
  try {
    const r=await pool.query('UPDATE users SET xp=xp+$1, pass_xp=pass_xp+$1 WHERE id=$2 RETURNING xp, level',[amount,userId]);
    const u=r.rows[0];
    const lvl=Math.floor(Number(u.xp)/1000)+1;
    if(lvl>Number(u.level)) await pool.query('UPDATE users SET level=$1, foxes=foxes+$2, crystals=crystals+1 WHERE id=$3',[lvl,lvl*10000,userId]);
  } catch (err) {
    if (err?.code === '42703') {
      console.warn('[DB] Missing column during addXp, running initDb and retrying once...');
      await initDb();
      const r=await pool.query('UPDATE users SET xp=xp+$1, pass_xp=pass_xp+$1 WHERE id=$2 RETURNING xp, level',[amount,userId]);
      const u=r.rows[0];
      const lvl=Math.floor(Number(u.xp)/1000)+1;
      if(lvl>Number(u.level)) await pool.query('UPDATE users SET level=$1, foxes=foxes+$2, crystals=crystals+1 WHERE id=$3',[lvl,lvl*10000,userId]);
      return;
    }
    throw err;
  }
}
async function daily(userId){ await pool.query('INSERT INTO daily_progress(user_id,day) VALUES($1,CURRENT_DATE) ON CONFLICT DO NOTHING',[userId]); const r=await pool.query('SELECT * FROM daily_progress WHERE user_id=$1 AND day=CURRENT_DATE',[userId]); return r.rows[0]; }
async function markDaily(userId, col, inc=false){ await daily(userId); if(inc) await pool.query(`UPDATE daily_progress SET ${col}=${col}+1 WHERE user_id=$1 AND day=CURRENT_DATE`,[userId]); else await pool.query(`UPDATE daily_progress SET ${col}=TRUE WHERE user_id=$1 AND day=CURRENT_DATE`,[userId]); }
async function clanBonus(userId){ const r=await pool.query('SELECT c.level FROM clans c JOIN clan_members m ON m.clan_id=c.id WHERE m.user_id=$1',[userId]); return r.rows[0] ? 1 + Number(r.rows[0].level)*0.02 : 1; }
async function ensureNotSpam(ctx,next){ if(!ctx.from) return next(); const t=Date.now(), k=ctx.from.id; const last=localSpam.get(k)||0; if(t-last<500) return; localSpam.set(k,t); const user=await requireUser(ctx); if(user?.is_banned) return ctx.reply('🚫 Ты заблокирован в боте.'); return next(); }
bot.use(ensureNotSpam);

// Groups: Telegram Privacy Mode hides ordinary text unless disabled in BotFather.
// This middleware makes group usage nicer when users mention the bot or use /русские команды.
let botUsernameCache = null;
async function botUsername(ctx){
  if(!botUsernameCache){
    try{ botUsernameCache = (await ctx.telegram.getMe()).username; }catch{ botUsernameCache = ''; }
  }
  return botUsernameCache;
}
async function normalizeGroupText(ctx,next){
  if(!ctx.message?.text || !isGroup(ctx)) return next();
  const username = await botUsername(ctx);
  let text = ctx.message.text.trim().replace(/\s+/g,' ');

  // @BlackFoxBot баланс  |  баланс @BlackFoxBot
  if(username){
    const mention = new RegExp(`@${username}\\b`, 'ig');
    text = text.replace(mention, '').trim();
  }

  // friendly prefixes: бот баланс / бфг баланс / blackfox баланс
  text = text.replace(/^(бот|бфг|bfg|blackfox|black fox)[,\s]+/i, '').trim();

  // /профиль, /баланс, /ферма etc. Telegram delivers slash messages even with Privacy Mode.
  const ruSlash = text.match(/^\/(профиль|баланс|ферма|сад|бизнес|кейсы|клан|казино)(?:\s+(.+))?$/i);
  if(ruSlash){
    text = `${ruSlash[1]}${ruSlash[2] ? ' ' + ruSlash[2] : ''}`;
  }

  ctx.state.originalText = ctx.message.text;
  ctx.message.text = text;
  return next();
}
bot.use(normalizeGroupText);

function mainKeyboard(){ return Markup.keyboard([['профиль','баланс','бонус'],['задания','pass','vip'],['казино инфо','кейсы','бизнес'],['ферма','сад','клан'],['инвентарь','рынок','vip']]).resize(); }
function farmButtons(){ return Markup.inlineKeyboard([[Markup.button.callback('💰 Собрать прибыль','fac_collect:farm'),Markup.button.callback('🦅 Оплатить налоги','fac_tax:farm')],[Markup.button.callback('⬆️ Улучшить ферму','fac_upgrade:farm'),Markup.button.callback('🔼 Купить видеокарту','fac_card:farm')]]); }
function gardenButtons(){ return Markup.inlineKeyboard([[Markup.button.callback('💰 Собрать прибыль','fac_collect:garden'),Markup.button.callback('🦅 Оплатить налоги','fac_tax:garden')],[Markup.button.callback('⬆️ Купить дерево','fac_tree:garden'),Markup.button.callback('💦 Полить сад','fac_water:garden')]]); }
function businessButtons(){ return Markup.inlineKeyboard([[Markup.button.callback('💰 Собрать прибыль','fac_collect:business'),Markup.button.callback('🦅 Оплатить налоги','fac_tax:business')],[Markup.button.callback('⬆️ Увеличить территорию','fac_territory:business'),Markup.button.callback('🆙 Увеличить бизнес','fac_upgrade:business')]]); }

function isPrivate(ctx){ return ctx.chat?.type === 'private'; }
function isGroup(ctx){ return ['group','supergroup'].includes(ctx.chat?.type); }
function groupKeyboard(){
  return Markup.inlineKeyboard([
    [Markup.button.callback('🎮 Команды чата','group_help'), Markup.button.callback('🏆 Топ','group_top')]
  ]);
}
function privateMenu(){
  return Markup.inlineKeyboard([
    [Markup.button.callback('👤 Профиль','menu_profile'), Markup.button.callback('💰 Баланс','menu_balance')],
    [Markup.button.callback('🎰 Игры','menu_games'), Markup.button.callback('🏗 Постройки','menu_buildings')],
    [Markup.button.callback('📦 Кейсы','menu_cases'), Markup.button.callback('🏰 Кланы','menu_clans')]
  ]);
}
function cleanCommandText(ctx){ return (ctx.message?.text || '').replace(/^\/\w+(?:@\w+)?\s*/,'').trim(); }
async function sendPrivateWelcome(ctx){
  const user=await requireUser(ctx);
  await ctx.reply(`🦊 <b>${BOT_NAME}</b>\n\nДобро пожаловать в экономическую игру нового поколения.\n\n💰 Баланс: <b>${m(user.foxes)}</b>\n💎 ${g(user.crystals)}\n🏅 Уровень: <b>${user.level}</b> • ${rank(user.level)}\n\nНажимай кнопки или пиши: <b>помощь</b>`, { parse_mode:'HTML', ...privateMenu() });
}
async function sendGroupWelcome(ctx){
  const me=await ctx.telegram.getMe();
  await ctx.reply(`🦊 <b>${BOT_NAME}</b> в чате!\n\nЯ добавил игровые команды для групп: рейтинги, казино, фан-команды, браки и быстрые профили.\n\n✅ Работает сразу: <code>/help</code>, <code>/profile</code>, <code>/balance</code>, <code>/casino 1000</code>, <code>/top</code>\n⚙️ Чтобы бот реагировал на обычный текст типа «баланс» в группе, отключи Privacy Mode у @BotFather.\n\nЛС: @${me.username}`, { parse_mode:'HTML', ...groupKeyboard() });
}
async function sendHelp(ctx){
  if(isGroup(ctx)) return sendGroupHelp(ctx);
  await ctx.reply(`🦊 <b>${BOT_NAME} — команды</b>\n\n<b>👤 Профиль</b>\nпрофиль, баланс, бонус, ежедневный бонус, задания, pass, vip, реф\n\n<b>🎰 Игры</b>\nказино 1000 / казино все / казино половина\nмины 1000, монетка 1000 орел, кубик 1000\n\n<b>🏗 Экономика</b>\nбизнес, ферма, генератор, карьер, сад, дерево, банк\n\n<b>📦 Инвентарь</b>\nкейсы, купить кейс 1 3, открыть кейс 1 3, зелья\n\n<b>🏰 Социалка</b>\nклан, рынок, свадьба ID, развод, мой брак\n\n<b>🔮 Развлечения</b>\nшар вопрос, выбери А или Б, инфа текст, испытать удачу`, { parse_mode:'HTML', ...privateMenu() });
}
async function sendGroupHelp(ctx){
  await ctx.reply(`🎮 <b>Команды для группы</b>\n\n<code>/profile</code> — твой профиль\n<code>/balance</code> — баланс\n<code>/casino 1000</code> — казино\n<code>/casino all</code> — ва-банк\n<code>/top</code> — топ игроков\n<code>/chat_top</code> — топ чата\n\nФан-команды при выключенном Privacy Mode:\nобнять @user, поцеловать @user, ударить @user, шар вопрос, инфа текст`, { parse_mode:'HTML', ...groupKeyboard() });
}
async function sendProfile(ctx){
  const u=await requireUser(ctx);
  const cl=await pool.query('SELECT c.title FROM clans c JOIN clan_members m ON m.clan_id=c.id WHERE m.user_id=$1',[u.id]);
  const mar=await pool.query('SELECT * FROM marriages WHERE user1_id=$1 OR user2_id=$1',[u.id]);
  await ctx.reply(`👤 <b>Профиль игрока</b>\n\n🆔 ID: <code>${u.tg_id}</code>\n👑 Ник: <b>${u.username?'@'+u.username:u.first_name}</b>\n🏅 Уровень: <b>${u.level}</b> • ${rank(u.level)}\n⚡ Опыт: <b>${u.xp}</b>\n\n💰 Баланс: <b>${m(u.foxes)}</b>\n🏦 Банк: <b>${m(u.bank)}</b>\n💎 ${g(u.crystals)}\n⭐ VIP: <b>${u.vip_level || 0}</b>\n\n🏰 Клан: <b>${cl.rows[0]?.title || 'нет'}</b>\n💒 Брак: <b>${mar.rows[0]?'есть':'нет'}</b>`, { parse_mode:'HTML' });
}
async function sendBalance(ctx){
  const u=await requireUser(ctx);
  await ctx.reply(`💰 <b>Баланс</b>\n\nНа руках: <b>${m(u.foxes)}</b>\nВ банке: <b>${m(u.bank)}</b>\nПремиум: <b>${g(u.crystals)}</b>`, { parse_mode:'HTML' });
}
async function sendTop(ctx, title='🏆 Топ игроков'){
  const r=await pool.query('SELECT username,first_name,foxes FROM users ORDER BY foxes DESC LIMIT 10');
  await ctx.reply(`<b>${title}</b>\n\n`+r.rows.map((u,i)=>`${i+1}. ${u.username?'@'+u.username:u.first_name} — <b>${m(u.foxes)}</b>`).join('\n'), { parse_mode:'HTML' });
}

async function sendCases(ctx){
  const u=await requireUser(ctx);
  const inv=await pool.query('SELECT * FROM user_cases WHERE user_id=$1',[u.id]);
  const owned=id=>inv.rows.find(x=>x.case_id===id)?.amount||0;
  await ctx.reply('📦 <b>Кейсы</b>\n\n'+cases.map(c=>`${c.id}. <b>${c.title}</b>\nЦена: ${m(c.price)} | У тебя: ${owned(c.id)}`).join('\n\n')+'\n\n🛒 Купить: <code>купить кейс 1 3</code>\n🔐 Открыть: <code>открыть кейс 1 3</code>', { parse_mode:'HTML' });
}
async function sendClan(ctx){
  const u=await requireUser(ctx);
  const r=await pool.query('SELECT c.*,m.role FROM clans c JOIN clan_members m ON m.clan_id=c.id WHERE m.user_id=$1',[u.id]);
  if(!r.rows[0]) return ctx.reply('🏰 <b>Клан</b>\n\nТы пока не в клане.\n\nСоздать: <code>клан создать Название</code>\nВступить: <code>клан вступить ID</code>\nСтоимость создания: <b>1.000.000 Фоксов</b>', { parse_mode:'HTML' });
  const c=r.rows[0];
  await ctx.reply(`🏰 <b>Клан ${c.title}</b>\n\nID: <code>${c.id}</code>\nУровень: <b>${c.level}</b>\nКазна: <b>${m(c.bank)}</b>\nБонус дохода: <b>+${c.level*2}%</b>\nТвоя роль: <b>${c.role}</b>\n\n<code>клан донат 10000</code>\n<code>клан улучшить</code>\n<code>клан участники</code>`, { parse_mode:'HTML' });
}

async function runSlashCasino(ctx){
  const u=await requireUser(ctx);
  const raw=cleanCommandText(ctx) || 'инфо';
  if(raw==='инфо') return ctx.reply('🎰 Казино\n\n/casino 1000\n/casino all\n/casino half\n\nШансы: x5 — 3%, x3 — 8%, x2 — 31%, проигрыш — 58%');
  const normalized=raw.replace(/^all$/i,'все').replace(/^half$/i,'половина');
  return casinoResult(ctx,parseAmount(normalized,u));
}

bot.start(async ctx=>{ if(isGroup(ctx)) return sendGroupWelcome(ctx); return sendPrivateWelcome(ctx); });
bot.on('new_chat_members', async ctx=>{ const me=await ctx.telegram.getMe(); const addedBot=ctx.message.new_chat_members.some(m=>m.id===me.id); if(addedBot) return sendGroupWelcome(ctx); });
bot.on('my_chat_member', async ctx=>{ const s=ctx.myChatMember?.new_chat_member?.status; if(isGroup(ctx) && ['member','administrator'].includes(s)) return sendGroupWelcome(ctx); });
bot.command(['help','menu'], sendHelp);
bot.command(['profile','me'], sendProfile);
bot.command(['balance','bal'], sendBalance);
bot.command(['top','leaders'], ctx=>sendTop(ctx));
bot.command(['chat_top'], ctx=>sendTop(ctx,'🏆 Топ чата'));
bot.command(['casino','kazik'], runSlashCasino);
bot.command(['business','biz'], ctx=>showFacility(ctx,'business'));
bot.command(['farm','ferma','mining'], ctx=>showFacility(ctx,'farm'));
bot.command(['garden','sad'], ctx=>showFacility(ctx,'garden'));
bot.command(['cases','case'], sendCases);
bot.command(['clan','klan'], sendClan);
bot.action('group_help', sendGroupHelp);
bot.action('group_top', ctx=>sendTop(ctx,'🏆 Топ чата'));
bot.action('menu_profile', sendProfile);
bot.action('menu_balance', sendBalance);
bot.action('menu_games', ctx=>ctx.reply(`🎰 Игры\n\nказино 1000\nказино все\nмины 1000\nмонетка 1000 орел\nкубик 1000`));
bot.action('menu_buildings', ctx=>ctx.reply(`🏗 Постройки\n\nбизнес\nферма\nсад\nгенератор\nкарьер\nденежное дерево`));
bot.action('menu_cases', ctx=>ctx.reply(`📦 Кейсы\n\nНапиши: кейсы`));
bot.action('menu_clans', ctx=>ctx.reply(`🏰 Кланы\n\nклан\nклан создать Название\nклан донат 1000\nклан улучшить`));
bot.hears(/^помощь$/i, sendHelp);

bot.hears(/^(профиль|кто я)$/i, sendProfile);
bot.hears(/^баланс$/i, sendBalance);
bot.hears(/^реф$/i, async ctx=>{ const u=await requireUser(ctx); const me=await ctx.telegram.getMe(); const c=await pool.query('SELECT COUNT(*) FROM users WHERE referrer_id=$1',[u.id]); await ctx.reply(`🔗 Твоя реф-ссылка:\nhttps://t.me/${me.username}?start=ref_${u.tg_id}\n\n👥 Рефералов: ${c.rows[0].count}\n🎁 За рефа: 50.000 Фоксов + 1 Кристалл`); });

bot.hears(/^(бонус|ежедневный бонус|daily)$/i, async ctx=>{
  const u = await requireUser(ctx);
  if (u.last_bonus_at && now() - new Date(u.last_bonus_at) < 86400000) {
    const left = 86400000 - (now() - new Date(u.last_bonus_at));
    const h = Math.floor(left / 3600000);
    const min = Math.ceil((left % 3600000) / 60000);
    return ctx.reply(`⏳ <b>Ежедневный бонус уже забран</b>

Возвращайся через: <b>${h}ч ${min}м</b>`, { parse_mode:'HTML' });
  }

  const baseReward = rnd(1_000_000, 20_000_000);
  const vipBonus = Math.floor(baseReward * (Number(u.vip_level || 0) * 0.10));
  const levelBonus = Math.floor(Number(u.level || 1) * 25_000);
  const reward = baseReward + vipBonus + levelBonus;

  await pool.query(
    'UPDATE users SET foxes=foxes+$1,last_bonus_at=NOW() WHERE id=$2',
    [reward, u.id]
  );
  await addXp(u.id, 150);
  await markDaily(u.id, 'bonus_done');

  await ctx.reply(
    `🎁 <b>Ежедневный бонус получен!</b>

` +
    `🎲 Рандом: <b>${m(baseReward)}</b>
` +
    `⭐ VIP-бонус: <b>${m(vipBonus)}</b>
` +
    `🏅 Бонус уровня: <b>${m(levelBonus)}</b>

` +
    `💰 Итого начислено: <b>${m(reward)}</b>
` +
    `⚡ Опыт: <b>+150 XP</b>`,
    { parse_mode:'HTML' }
  );
});
bot.hears(/^работа$/i, async ctx=>{ const u=await requireUser(ctx); if(u.last_work_at && now()-new Date(u.last_work_at)<3600000) return ctx.reply('⏳ Работать можно раз в час.'); const reward=rnd(8000,35000)+u.level*1000; await pool.query('UPDATE users SET foxes=foxes+$1,last_work_at=NOW() WHERE id=$2',[reward,u.id]); await addXp(u.id,50); await ctx.reply(`🧰 Ты поработал и получил ${m(reward)}\n⚡ +50 XP`); });

bot.hears(/^задания$/i, async ctx=>{ const u=await requireUser(ctx); const d=await daily(u.id); const done=[d.bonus_done,d.casino_count>=5,d.collect_done,d.garden_done,d.case_done].filter(Boolean).length; const txt=`📋 Задания на сегодня\n\n1. Забрать бонус — ${d.bonus_done?'✅':'❌'}\n2. Сыграть в казино 5 раз — ${d.casino_count}/5\n3. Собрать прибыль — ${d.collect_done?'✅':'❌'}\n4. Полить сад — ${d.garden_done?'✅':'❌'}\n5. Открыть кейс — ${d.case_done?'✅':'❌'}\n\nНаграда: 150.000 Фоксов + 5 Кристаллов\nГотово: ${done}/5`; await ctx.reply(txt, Markup.inlineKeyboard([[Markup.button.callback('🎁 Забрать награду','daily_claim')]])); });
bot.action('daily_claim', async ctx=>{ const u=await requireUser(ctx); const d=await daily(u.id); if(d.claimed) return ctx.answerCbQuery('Уже забрано'); if(!(d.bonus_done && d.casino_count>=5 && d.collect_done && d.garden_done && d.case_done)) return ctx.answerCbQuery('Не все задания выполнены'); await pool.query('UPDATE daily_progress SET claimed=TRUE WHERE user_id=$1 AND day=CURRENT_DATE',[u.id]); await pool.query('UPDATE users SET foxes=foxes+150000, crystals=crystals+5 WHERE id=$1',[u.id]); await addXp(u.id,300); await ctx.editMessageText('🎁 Награда за задания получена: 150.000 Фоксов + 5 Кристаллов + 300 XP'); });

bot.hears(/^(pass|пас|пропуск)$/i, async ctx=>{ const u=await requireUser(ctx); const lvl=Math.min(50,Math.floor(u.pass_xp/500)+1); await ctx.reply(`🎫 Fox Pass\n\nУровень: ${lvl}/50\nОпыт пропуска: ${u.pass_xp}\nPremium: ${u.pass_premium?'✅':'❌'}\n\nКаждый уровень можно забрать кнопкой.`, Markup.inlineKeyboard([[Markup.button.callback('🎁 Забрать free','pass_free'),Markup.button.callback('💎 Забрать premium','pass_premium')],[Markup.button.callback('⭐ Купить premium за 150 💎','pass_buy')]])); });
bot.action('pass_buy', async ctx=>{ const u=await requireUser(ctx); if(Number(u.crystals)<150) return ctx.answerCbQuery('Нужно 150 кристаллов'); await pool.query('UPDATE users SET crystals=crystals-150, pass_premium=TRUE WHERE id=$1',[u.id]); await ctx.answerCbQuery('Premium куплен'); });
async function claimPass(ctx,premium=false){ const u=await requireUser(ctx); const lvl=Math.min(50,Math.floor(u.pass_xp/500)+1); if(premium && !u.pass_premium) return ctx.answerCbQuery('Premium не куплен'); const r=await pool.query('SELECT * FROM pass_rewards WHERE user_id=$1 AND level=$2 AND premium=$3',[u.id,lvl,premium]); if(r.rows[0]) return ctx.answerCbQuery('Уже забрано'); await pool.query('INSERT INTO pass_rewards(user_id,level,premium) VALUES($1,$2,$3)',[u.id,lvl,premium]); const fox=premium?lvl*100000:lvl*30000, cr=premium?lvl:0; await pool.query('UPDATE users SET foxes=foxes+$1, crystals=crystals+$2 WHERE id=$3',[fox,cr,u.id]); await ctx.answerCbQuery('Забрано'); await ctx.reply(`🎫 Награда Fox Pass: ${m(fox)}${cr?` + ${g(cr)}`:''}`); }
bot.action('pass_free', ctx=>claimPass(ctx,false)); bot.action('pass_premium', ctx=>claimPass(ctx,true));

bot.hears(/^vip$/i, ctx=>ctx.reply(`⭐ VIP\n\nVIP 1: +10% к бонусам и доходам\nVIP 2: +20%\nVIP 3: +30%\n\nКоманды:\nкупить vip 1\nкупить vip 7\nкупить vip 30`));
bot.hears(/^купить vip (1|7|30)$/i, async ctx=>{ const u=await requireUser(ctx); const days=Number(ctx.match[1]); const cost={1:20,7:100,30:300}[days]; if(Number(u.crystals)<cost) return ctx.reply(`❌ Нужно ${g(cost)}`); await pool.query(`UPDATE users SET crystals=crystals-$1, vip_level=GREATEST(vip_level,1), vip_until=GREATEST(COALESCE(vip_until,NOW()),NOW()) + ($2 || ' days')::interval WHERE id=$3`,[cost,days,u.id]); await ctx.reply(`⭐ VIP активирован на ${days} дн.`); });

async function casinoResult(ctx,bet,mode='casino'){ const u=await requireUser(ctx); if(!Number.isFinite(bet)||bet<100) return ctx.reply('❌ Минимальная ставка 100.'); if(Number(u.foxes)<bet) return ctx.reply('❌ Не хватает Фоксов.'); const roll=Math.random(); let mult=0, label='💸 Проигрыш'; if(roll<.03){mult=5;label='💎 x5'} else if(roll<.11){mult=3;label='🔥 x3'} else if(roll<.42){mult=2;label='🎰 x2'} const delta=bet*mult-bet; await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2',[delta,u.id]); await addXp(u.id,35); await markDaily(u.id,'casino_count',true); await logTx(u.id,'casino',delta,mode); await ctx.reply(`${label}\n\nСтавка: ${m(bet)}\n${delta>=0?'Выигрыш':'Потеря'}: ${m(Math.abs(delta))}`); }
bot.hears(/^казино(?:\s+(.+))?$/i, async ctx=>{ const u=await requireUser(ctx); const raw=ctx.match[1]; if(!raw || raw==='инфо') return ctx.reply('🎰 Казино\n\nказино 1000\nказино все\nказино половина\n\nШансы: x5 — 3%, x3 — 8%, x2 — 31%, проигрыш — 58%'); return casinoResult(ctx,parseAmount(raw,u)); });
bot.hears(/^монетка\s+(\S+)\s+(орел|орёл|решка)$/i, async ctx=>{ const u=await requireUser(ctx); const bet=parseAmount(ctx.match[1],u), side=ctx.match[2].replace('ё','е'); if(bet<100||Number(u.foxes)<bet) return ctx.reply('❌ Неверная ставка.'); const win=(Math.random()<.49); const res=Math.random()<.5?'орел':'решка'; const delta=win?bet:-bet; await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2',[delta,u.id]); await markDaily(u.id,'casino_count',true); await addXp(u.id,25); await ctx.reply(`🪙 Выпало: ${res}\n${win?'✅ Победа':'❌ Проигрыш'}: ${m(Math.abs(delta))}`); });
bot.hears(/^(кубик|дартс|баскет|боулинг)\s+(\S+)(?:\s+(больше|меньше))?$/i, async ctx=>{ const u=await requireUser(ctx); const game=ctx.match[1].toLowerCase(), bet=parseAmount(ctx.match[2],u); if(bet<100||Number(u.foxes)<bet) return ctx.reply('❌ Неверная ставка.'); const n=rnd(1,6); const win = game==='кубик' && ctx.match[3] ? (ctx.match[3]==='больше'?n>=4:n<=3) : n>=4; const delta=win?bet:-bet; await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2',[delta,u.id]); await markDaily(u.id,'casino_count',true); await addXp(u.id,25); await ctx.reply(`🎲 ${game}: ${n}\n${win?'✅ Победа':'❌ Проигрыш'} ${m(Math.abs(delta))}`); });
bot.hears(/^мины\s+(\S+)$/i, async ctx=>{ const u=await requireUser(ctx); const bet=parseAmount(ctx.match[1],u); if(bet<100||Number(u.foxes)<bet) return ctx.reply('❌ Неверная ставка.'); await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2',[bet,u.id]); const bomb=rnd(0,8); const payload={bet,bomb,opened:[]}; await ctx.reply('💣 Мины\nОткрой клетки. Забрать можно после первого сейфа.', minesKb(payload)); });
function minesKb(s){ const rows=[]; for(let i=0;i<9;i+=3){ rows.push([0,1,2].map(j=>{ const k=i+j; return Markup.button.callback(s.opened.includes(k)?'✅':`${k+1}`,`mine:${Buffer.from(JSON.stringify(s)).toString('base64')}:${k}`)})); } rows.push([Markup.button.callback('💰 Забрать','minecash:'+Buffer.from(JSON.stringify(s)).toString('base64'))]); return Markup.inlineKeyboard(rows); }
bot.action(/^mine:(.+):(\d+)$/, async ctx=>{ const u=await requireUser(ctx); const s=JSON.parse(Buffer.from(ctx.match[1],'base64').toString()); const k=Number(ctx.match[2]); if(s.opened.includes(k)) return ctx.answerCbQuery('Уже открыто'); if(k===s.bomb){ await markDaily(u.id,'casino_count',true); await ctx.editMessageText(`💥 Бомба! Ты потерял ${m(s.bet)}`); return; } s.opened.push(k); await ctx.editMessageText(`💣 Мины\nОткрыто: ${s.opened.length}\nТекущий выигрыш: ${m(Math.floor(s.bet*(1+s.opened.length*.35)))}`, minesKb(s)); });
bot.action(/^minecash:(.+)$/, async ctx=>{ const u=await requireUser(ctx); const s=JSON.parse(Buffer.from(ctx.match[1],'base64').toString()); if(!s.opened.length) return ctx.answerCbQuery('Сначала открой клетку'); const win=Math.floor(s.bet*(1+s.opened.length*.35)); await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2',[win,u.id]); await markDaily(u.id,'casino_count',true); await addXp(u.id,50); await ctx.editMessageText(`💰 Забрано: ${m(win)}`); });

bot.hears(/^кейсы$/i, sendCases);
bot.hears(/^купить кейс (\d+)\s*(\d+)?$/i, async ctx=>{ const u=await requireUser(ctx); const c=cases.find(x=>x.id===Number(ctx.match[1])); const count=Math.min(100,Number(ctx.match[2]||1)); if(!c||count<1) return ctx.reply('❌ Нет такого кейса.'); const cost=c.price*count; if(Number(u.foxes)<cost) return ctx.reply('❌ Не хватает Фоксов.'); await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2',[cost,u.id]); await pool.query('INSERT INTO user_cases(user_id,case_id,amount) VALUES($1,$2,$3) ON CONFLICT(user_id,case_id) DO UPDATE SET amount=user_cases.amount+EXCLUDED.amount',[u.id,c.id,count]); await addItem(u.id,c.key,c.title,count); await ctx.reply(`🛒 Куплено: ${c.title} x${count}`); });
bot.hears(/^открыть кейс (\d+)\s*(\d+)?$/i, async ctx=>{ const u=await requireUser(ctx); const c=cases.find(x=>x.id===Number(ctx.match[1])); const count=Math.min(20,Number(ctx.match[2]||1)); if(!c||count<1) return ctx.reply('❌ Нет такого кейса.'); const take=await pool.query('UPDATE user_cases SET amount=amount-$1 WHERE user_id=$2 AND case_id=$3 AND amount>=$1 RETURNING amount',[count,u.id,c.id]); if(!take.rows[0]) return ctx.reply('❌ У тебя нет столько кейсов.'); await takeItem(u.id,c.key,count); let fox=0, cr=0, text=[]; const luck=u.case_luck_until && new Date(u.case_luck_until)>now() ? .03 : 0; for(let i=0;i<count;i++){ let win=rnd(c.min,c.max); if(Math.random()<c.jackpot+luck) win*=5; fox+=win; if(Math.random()<c.gemChance+luck){ cr+=c.gems; } text.push(`+${cash(win)}`); } await pool.query('UPDATE users SET foxes=foxes+$1, crystals=crystals+$2 WHERE id=$3',[fox,cr,u.id]); await addXp(u.id,40*count); await markDaily(u.id,'case_done'); await ctx.reply(`🔐 Открыто ${c.title} x${count}\n\n${text.slice(0,10).join('\n')}${text.length>10?'\n...':''}\n\nИтого: ${m(fox)}${cr?` + ${g(cr)}`:''}`); });

async function showFacility(ctx,kind){ const u=await requireUser(ctx); const fdef=facilities[kind]; let r=await pool.query('SELECT * FROM facilities WHERE user_id=$1 AND kind=$2',[u.id,kind]); if(!r.rows[0]) return ctx.reply(`${fdef.icon} ${fdef.title}\n\nУ тебя пока нет постройки.\nКоманда: ${fdef.build}\nЦена: ${m(fdef.price)}`); const f=r.rows[0]; const mult=(u.income_boost_until&&new Date(u.income_boost_until)>now()?1.25:1)*(1+(u.vip_level||0)*.1)*await clanBonus(u.id); const income=Math.floor(Number(f.income)*Number(f.level)*mult); let txt=`${fdef.icon} ${fdef.title}\n\n🥐 Доход: ${cash(income)} / ${fdef.interval}ч\n📈 Уровень: ${f.level}\n🦅 Налоги: ${cash(f.tax_debt)} / ${cash(f.tax_limit)}\n📦 На счету: ${cash(f.account)}`; if(kind==='farm') txt+=`\n🎬 Видеокарты: ${f.video_cards}/${f.max_video_cards}\n🆙 Цена видеокарты: ${cash(150000+f.video_cards*50000)}`; if(kind==='business') txt+=`\n⬆️ Территория: ${f.territory_m2} м²\n🆙 Бизнес: ${f.business_m2} м²`; if(kind==='garden') txt+=`\n🌳 Деревья: ${f.trees_count}\n💦 Воды: ${f.water}/${f.max_water}`; const kb=kind==='farm'?farmButtons():kind==='garden'?gardenButtons():kind==='business'?businessButtons():Markup.inlineKeyboard([[Markup.button.callback('💰 Собрать прибыль',`fac_collect:${kind}`),Markup.button.callback('🦅 Оплатить налоги',`fac_tax:${kind}`)],[Markup.button.callback('⬆️ Улучшить',`fac_upgrade:${kind}`)]]); await ctx.reply(txt,kb); }
for(const [kind,d] of Object.entries(facilities)){ bot.hears(new RegExp(`^(${d.aliases.join('|')})$`,'i'), ctx=>showFacility(ctx,kind)); bot.hears(new RegExp(`^${d.build}$`,'i'), async ctx=>{ const u=await requireUser(ctx); const exists=await pool.query('SELECT id FROM facilities WHERE user_id=$1 AND kind=$2',[u.id,kind]); if(exists.rows[0]) return ctx.reply('✅ Уже построено.'); if(Number(u.foxes)<d.price) return ctx.reply(`❌ Нужно ${m(d.price)}`); await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2',[d.price,u.id]); await pool.query('INSERT INTO facilities(user_id,kind,title,income,last_collect_at,last_tick_at,video_cards) VALUES($1,$2,$3,$4,NOW(),NOW(),$5)',[u.id,kind,d.title,d.income,kind==='farm'?1:0]); await addXp(u.id,120); await ctx.reply(`🏗 Построено: ${d.title}`); }); bot.hears(new RegExp(`^продать ${kind==='farm'?'ферму':kind==='business'?'бизнес':d.title.toLowerCase()}$`,'i'), ctx=>ctx.reply('💰 Продажа временно недоступна.')); }
async function collectFacility(ctx,kind){ const u=await requireUser(ctx); const d=facilities[kind]; const r=await pool.query('SELECT * FROM facilities WHERE user_id=$1 AND kind=$2',[u.id,kind]); const f=r.rows[0]; if(!f) return ctx.reply(`❌ Сначала: ${d.build}`); const last=f.last_collect_at?new Date(f.last_collect_at):new Date(0); if(now()-last<d.interval*3600000) return ctx.reply(`⏳ Прибыль можно собирать раз в ${d.interval}ч.`); const mult=(u.income_boost_until&&new Date(u.income_boost_until)>now()?1.25:1)*(1+(u.vip_level||0)*.1)*await clanBonus(u.id); let inc=Math.floor(Number(f.income)*Number(f.level)*mult); if(kind==='farm') inc*=Math.max(1,Number(f.video_cards)); if(kind==='garden') inc*=Math.max(1,Number(f.trees_count)/10); const tax=Math.floor(inc*.08); if(Number(f.tax_debt)+tax>Number(f.tax_limit)) return ctx.reply('🦅 Сначала оплати налоги, лимит переполнен.'); await pool.query('UPDATE facilities SET last_collect_at=NOW(), account=account+$1, tax_debt=tax_debt+$2 WHERE id=$3',[inc,tax,f.id]); await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2',[inc,u.id]); await markDaily(u.id,'collect_done'); await addXp(u.id,80); await ctx.reply(`💰 Собрано: ${m(inc)}\n🦅 Налог начислен: ${m(tax)}`); }
bot.action(/^fac_collect:(\w+)$/, ctx=>collectFacility(ctx,ctx.match[1]));
bot.action(/^fac_tax:(\w+)$/, async ctx=>{ const u=await requireUser(ctx); const f=await pool.query('SELECT * FROM facilities WHERE user_id=$1 AND kind=$2',[u.id,ctx.match[1]]); if(!f.rows[0]) return ctx.answerCbQuery('Нет постройки'); const debt=Number(f.rows[0].tax_debt); if(debt<=0) return ctx.answerCbQuery('Налогов нет'); if(Number(u.foxes)<debt) return ctx.reply('❌ Не хватает Фоксов.'); await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2',[debt,u.id]); await pool.query('UPDATE facilities SET tax_debt=0 WHERE id=$1',[f.rows[0].id]); await ctx.reply(`🦅 Налоги оплачены: ${m(debt)}`); });
bot.action(/^fac_upgrade:(\w+)$/, async ctx=>{ const u=await requireUser(ctx); const kind=ctx.match[1]; const r=await pool.query('SELECT * FROM facilities WHERE user_id=$1 AND kind=$2',[u.id,kind]); const f=r.rows[0]; if(!f) return ctx.answerCbQuery('Нет постройки'); const cost=Number(f.level)*500000; if(Number(u.foxes)<cost) return ctx.reply(`❌ Нужно ${m(cost)}`); await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2',[cost,u.id]); await pool.query('UPDATE facilities SET level=level+1,income=income*1.25 WHERE id=$1',[f.id]); await ctx.reply(`⬆️ Улучшено до уровня ${Number(f.level)+1}`); });
bot.action(/^fac_card:farm$/, async ctx=>{ const u=await requireUser(ctx); const r=await pool.query("SELECT * FROM facilities WHERE user_id=$1 AND kind='farm'",[u.id]); const f=r.rows[0]; if(!f) return ctx.reply('❌ Сначала построй ферму.'); if(f.video_cards>=f.max_video_cards) return ctx.reply('✅ Максимум видеокарт.'); const cost=150000+Number(f.video_cards)*50000; if(Number(u.foxes)<cost) return ctx.reply(`❌ Нужно ${m(cost)}`); await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2',[cost,u.id]); await pool.query('UPDATE facilities SET video_cards=video_cards+1 WHERE id=$1',[f.id]); await ctx.reply('🎬 Видеокарта куплена.'); });
bot.action(/^fac_tree:garden$/, async ctx=>{ const u=await requireUser(ctx); const f=(await pool.query("SELECT * FROM facilities WHERE user_id=$1 AND kind='garden'",[u.id])).rows[0]; if(!f) return ctx.reply('❌ Сначала построй сад.'); const cost=100000+Number(f.trees_count)*25000; if(Number(u.foxes)<cost) return ctx.reply(`❌ Нужно ${m(cost)}`); await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2',[cost,u.id]); await pool.query('UPDATE facilities SET trees_count=trees_count+1 WHERE id=$1',[f.id]); await ctx.reply('🌳 Дерево куплено.'); });
bot.action(/^fac_water:garden$/, async ctx=>{ const u=await requireUser(ctx); await pool.query("UPDATE facilities SET water=max_water WHERE user_id=$1 AND kind='garden'",[u.id]); await markDaily(u.id,'garden_done'); await ctx.reply('💦 Сад полит.'); });
bot.action(/^fac_territory:business$/, async ctx=>{ const u=await requireUser(ctx); const f=(await pool.query("SELECT * FROM facilities WHERE user_id=$1 AND kind='business'",[u.id])).rows[0]; const cost=250000+Number(f.territory_m2)*1000; if(Number(u.foxes)<cost) return ctx.reply(`❌ Нужно ${m(cost)}`); await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2',[cost,u.id]); await pool.query('UPDATE facilities SET territory_m2=territory_m2+40 WHERE id=$1',[f.id]); await ctx.reply('⬆️ Территория увеличена.'); });

bot.hears(/^инвентарь$/i, async ctx=>{ const u=await requireUser(ctx); const r=await pool.query('SELECT * FROM inventory_items WHERE user_id=$1 AND amount>0 ORDER BY title',[u.id]); if(!r.rows.length) return ctx.reply('🎒 Инвентарь пуст.'); await ctx.reply('🎒 Инвентарь\n\n'+r.rows.map(x=>`${x.title}: ${x.amount} шт.`).join('\n')+'\n\nиспользовать зелье 1'); });
bot.hears(/^зелья$/i, ctx=>ctx.reply('🍸 Зелья\n\n'+potions.map(p=>`${p.id}. ${p.title}\nЦена: ${p.cost} 💎 — ${p.text}`).join('\n\n')+'\n\nсоздать зелье 1'));
bot.hears(/^создать зелье (\d+)$/i, async ctx=>{ const u=await requireUser(ctx); const p=potions.find(x=>x.id===Number(ctx.match[1])); if(!p) return ctx.reply('❌ Нет такого зелья.'); if(Number(u.crystals)<p.cost) return ctx.reply(`❌ Нужно ${g(p.cost)}`); await pool.query('UPDATE users SET crystals=crystals-$1 WHERE id=$2',[p.cost,u.id]); await addItem(u.id,p.key,p.title,1); await ctx.reply(`🍸 Создано: ${p.title}`); });
bot.hears(/^использовать зелье (\d+)$/i, async ctx=>{ const u=await requireUser(ctx); const p=potions.find(x=>x.id===Number(ctx.match[1])); if(!p) return ctx.reply('❌ Нет такого зелья.'); const ok=await takeItem(u.id,p.key,1); if(!ok) return ctx.reply('❌ Такого зелья нет в инвентаре.'); if(p.id===1) await pool.query("UPDATE users SET case_luck_until=NOW()+INTERVAL '2 hours' WHERE id=$1",[u.id]); if(p.id===2) await pool.query("UPDATE users SET income_boost_until=NOW()+INTERVAL '2 hours' WHERE id=$1",[u.id]); if(p.id===3) await pool.query('UPDATE users SET luck_charges=luck_charges+3 WHERE id=$1',[u.id]); await ctx.reply(`✅ Использовано: ${p.title}`); });

bot.hears(/^рынок$/i, async ctx=>{ const r=await pool.query("SELECT * FROM market_lots WHERE status='active' ORDER BY created_at DESC LIMIT 10"); await ctx.reply('🛒 Рынок\n\n'+(r.rows.map(x=>`${x.id}. ${x.title} x${x.amount} — ${m(x.price)}`).join('\n')||'Пусто')+'\n\nрынок купить ID\nрынок выставить case_1 1 500000'); });
bot.hears(/^рынок выставить (\S+)\s+(\d+)\s+(\d+)$/i, async ctx=>{ const u=await requireUser(ctx); const [key,amount,price]=[ctx.match[1],Number(ctx.match[2]),Number(ctx.match[3])]; const item=(await pool.query('SELECT * FROM inventory_items WHERE user_id=$1 AND item_key=$2 AND amount>=$3',[u.id,key,amount])).rows[0]; if(!item) return ctx.reply('❌ Нет такого предмета/количества.'); await takeItem(u.id,key,amount); await pool.query('INSERT INTO market_lots(seller_user_id,item_key,title,amount,price) VALUES($1,$2,$3,$4,$5)',[u.id,key,item.title,amount,price]); await ctx.reply('🛒 Лот выставлен.'); });
bot.hears(/^рынок купить (\d+)$/i, async ctx=>{ const u=await requireUser(ctx); const lot=(await pool.query("SELECT * FROM market_lots WHERE id=$1 AND status='active'",[Number(ctx.match[1])])).rows[0]; if(!lot) return ctx.reply('❌ Лот не найден.'); if(Number(u.foxes)<Number(lot.price)) return ctx.reply('❌ Не хватает Фоксов.'); await pool.query('BEGIN'); try{ await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2',[lot.price,u.id]); await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2',[lot.price,lot.seller_user_id]); await addItem(u.id,lot.item_key,lot.title,lot.amount); await pool.query("UPDATE market_lots SET status='sold', sold_at=NOW() WHERE id=$1",[lot.id]); await pool.query('COMMIT'); await ctx.reply('✅ Куплено.'); }catch(e){ await pool.query('ROLLBACK'); throw e; } });

bot.hears(/^клан$/i, sendClan);
bot.hears(/^клан создать (.+)$/i, async ctx=>{ const u=await requireUser(ctx); const has=await pool.query('SELECT id FROM clan_members WHERE user_id=$1',[u.id]); if(has.rows[0]) return ctx.reply('❌ Ты уже в клане.'); const cost=1000000; if(Number(u.foxes)<cost) return ctx.reply(`❌ Нужно ${m(cost)}`); await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2',[cost,u.id]); const c=await pool.query('INSERT INTO clans(title,owner_user_id) VALUES($1,$2) RETURNING *',[ctx.match[1].slice(0,32),u.id]); await pool.query("INSERT INTO clan_members(clan_id,user_id,role) VALUES($1,$2,'owner')",[c.rows[0].id,u.id]); await ctx.reply(`🏰 Клан создан: ${c.rows[0].title}\nID: ${c.rows[0].id}`); });
bot.hears(/^клан вступить (\d+)$/i, async ctx=>{ const u=await requireUser(ctx); const has=await pool.query('SELECT id FROM clan_members WHERE user_id=$1',[u.id]); if(has.rows[0]) return ctx.reply('❌ Ты уже в клане.'); const c=await pool.query('SELECT * FROM clans WHERE id=$1',[Number(ctx.match[1])]); if(!c.rows[0]) return ctx.reply('❌ Клан не найден.'); await pool.query('INSERT INTO clan_members(clan_id,user_id) VALUES($1,$2)',[c.rows[0].id,u.id]); await ctx.reply(`✅ Ты вступил в клан ${c.rows[0].title}`); });
bot.hears(/^клан донат (\S+)$/i, async ctx=>{ const u=await requireUser(ctx); const amount=parseAmount(ctx.match[1],u); if(amount<1||Number(u.foxes)<amount) return ctx.reply('❌ Неверная сумма.'); const cm=await pool.query('SELECT * FROM clan_members WHERE user_id=$1',[u.id]); if(!cm.rows[0]) return ctx.reply('❌ Ты не в клане.'); await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2',[amount,u.id]); await pool.query('UPDATE clans SET bank=bank+$1,xp=xp+$2 WHERE id=$3',[amount,Math.floor(amount/1000),cm.rows[0].clan_id]); await ctx.reply(`🏦 В казну отправлено: ${m(amount)}`); });
bot.hears(/^клан улучшить$/i, async ctx=>{ const u=await requireUser(ctx); const c=(await pool.query('SELECT c.* FROM clans c JOIN clan_members m ON m.clan_id=c.id WHERE m.user_id=$1',[u.id])).rows[0]; if(!c) return ctx.reply('❌ Ты не в клане.'); const cost=Number(c.level)*2000000; if(Number(c.bank)<cost) return ctx.reply(`❌ В казне нужно ${m(cost)}`); await pool.query('UPDATE clans SET bank=bank-$1, level=level+1 WHERE id=$2',[cost,c.id]); await ctx.reply(`⬆️ Клан улучшен до ${Number(c.level)+1} уровня.`); });
bot.hears(/^клан участники$/i, async ctx=>{ const u=await requireUser(ctx); const cm=(await pool.query('SELECT clan_id FROM clan_members WHERE user_id=$1',[u.id])).rows[0]; if(!cm) return ctx.reply('❌ Ты не в клане.'); const r=await pool.query('SELECT u.username,u.first_name,m.role FROM clan_members m JOIN users u ON u.id=m.user_id WHERE m.clan_id=$1 LIMIT 30',[cm.clan_id]); await ctx.reply('👥 Участники\n\n'+r.rows.map(x=>`${x.role} — ${x.username?'@'+x.username:x.first_name}`).join('\n')); });
bot.hears(/^топ кланы$/i, async ctx=>{ const r=await pool.query('SELECT * FROM clans ORDER BY level DESC, bank DESC LIMIT 10'); await ctx.reply('🏆 Топ кланы\n\n'+(r.rows.map((c,i)=>`${i+1}. ${c.title} — ур.${c.level}, ${m(c.bank)}`).join('\n')||'Пусто')); });

bot.hears(/^свадьба (\S+)$/i, async ctx=>{ const u=await requireUser(ctx); const p=await getUserByAny(ctx.match[1]); if(!p||p.id===u.id) return ctx.reply('❌ Пользователь не найден.'); const exists=await pool.query('SELECT id FROM marriages WHERE user1_id IN ($1,$2) OR user2_id IN ($1,$2)',[u.id,p.id]); if(exists.rows[0]) return ctx.reply('❌ У кого-то уже есть брак.'); await pool.query('INSERT INTO marriages(user1_id,user2_id) VALUES($1,$2)',[u.id,p.id]); await ctx.reply(`💒 Свадьба состоялась! ${u.first_name} + ${p.username?'@'+p.username:p.first_name}`); });
bot.hears(/^развод$/i, async ctx=>{ const u=await requireUser(ctx); await pool.query('DELETE FROM marriages WHERE user1_id=$1 OR user2_id=$1',[u.id]); await ctx.reply('💔 Развод оформлен.'); });
bot.hears(/^мой брак$/i, async ctx=>{ const u=await requireUser(ctx); const r=await pool.query('SELECT * FROM marriages WHERE user1_id=$1 OR user2_id=$1',[u.id]); if(!r.rows[0]) return ctx.reply('💌 Ты пока не в браке.'); const other=r.rows[0].user1_id===u.id?r.rows[0].user2_id:r.rows[0].user1_id; const p=(await pool.query('SELECT * FROM users WHERE id=$1',[other])).rows[0]; await ctx.reply(`💌 Твой брак: ${p.username?'@'+p.username:p.first_name}\nДата: ${r.rows[0].created_at.toLocaleString?.()||r.rows[0].created_at}`); });

bot.hears(/^шар (.+)$/i, ctx=>{ const a=['Да','Нет','Скорее да','Скорее нет','Лис говорит: рискни','Лучше завтра','100%, но без паники','Сомнительно']; ctx.reply(`🔮 ${ctx.match[1]}\n\n${a[rnd(0,a.length-1)]}`); });
bot.hears(/^выбери (.+) или (.+)$/i, ctx=>ctx.reply(`💬 Я выбираю: ${Math.random()<.5?ctx.match[1]:ctx.match[2]}`));
bot.hears(/^инфа (.+)$/i, ctx=>ctx.reply(`📊 Инфа по «${ctx.match[1]}»: ${rnd(0,100)}%`));
bot.hears(/^испытать удачу$/i, async ctx=>{ const u=await requireUser(ctx); if(u.last_luck_at && now()-new Date(u.last_luck_at)<3600000 && u.luck_charges<=0) return ctx.reply('🍀 Удачу можно испытывать раз в час.'); const win=Math.random()<.45; const reward=win?rnd(10000,150000):0; await pool.query('UPDATE users SET foxes=foxes+$1,last_luck_at=NOW(),luck_charges=GREATEST(luck_charges-1,0) WHERE id=$2',[reward,u.id]); await addXp(u.id,30); await ctx.reply(win?`🍀 Удача с тобой: ${m(reward)}`:'🍀 Сегодня не повезло.'); });

bot.hears(/^передать (\S+)\s+(\S+)$/i, async ctx=>{ const u=await requireUser(ctx); if(u.level<3) return ctx.reply('❌ Передачи доступны с 3 уровня.'); const p=await getUserByAny(ctx.match[1]); const amount=parseAmount(ctx.match[2],u); if(!p||p.id===u.id) return ctx.reply('❌ Получатель не найден.'); if(amount<100||amount>Number(u.foxes)) return ctx.reply('❌ Неверная сумма.'); await pool.query('UPDATE users SET foxes=foxes-$1 WHERE id=$2',[amount,u.id]); await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2',[amount,p.id]); await logTx(u.id,'transfer_out',amount,`to ${p.tg_id}`); await logTx(p.id,'transfer_in',amount,`from ${u.tg_id}`); await ctx.reply(`✅ Передано ${m(amount)} игроку ${p.username?'@'+p.username:p.first_name}`); });
bot.hears(/^топ$/i, async ctx=>{ const r=await pool.query('SELECT username,first_name,foxes FROM users ORDER BY foxes DESC LIMIT 10'); await ctx.reply('🏆 Топ игроков\n\n'+r.rows.map((u,i)=>`${i+1}. ${u.username?'@'+u.username:u.first_name} — ${m(u.foxes)}`).join('\n')); });
bot.hears(/^промо (\S+)$/i, async ctx=>{ const u=await requireUser(ctx); const code=ctx.match[1].toUpperCase(); const client=await pool.connect(); try{ await client.query('BEGIN'); const pr=(await client.query('SELECT * FROM promo_codes WHERE UPPER(code)=UPPER($1) FOR UPDATE',[code])).rows[0]; if(!pr){ await client.query('ROLLBACK'); return ctx.reply('❌ Промокод не найден.'); } if(pr.activations>=pr.max_activations){ await client.query('ROLLBACK'); return ctx.reply('❌ Активации закончились.'); } if(pr.only_vip && !u.vip_level){ await client.query('ROLLBACK'); return ctx.reply('❌ Только для VIP.'); } if(u.level<pr.min_level){ await client.query('ROLLBACK'); return ctx.reply(`❌ Нужен уровень ${pr.min_level}.`); } if(pr.expires_at && new Date(pr.expires_at)<now()){ await client.query('ROLLBACK'); return ctx.reply('❌ Промокод истек.'); } const used=(await client.query('SELECT id FROM promo_activations WHERE promo_id=$1 AND user_id=$2',[pr.id,u.id])).rows[0]; if(used){ await client.query('ROLLBACK'); return ctx.reply('❌ Уже активировал.'); } await client.query('INSERT INTO promo_activations(promo_id,user_id) VALUES($1,$2)',[pr.id,u.id]); await client.query('UPDATE promo_codes SET activations=activations+1 WHERE id=$1',[pr.id]); await client.query('UPDATE users SET foxes=foxes+$1, crystals=crystals+$2 WHERE id=$3',[pr.reward_foxes,pr.reward_crystals,u.id]); await client.query('COMMIT'); await ctx.reply(`✅ Промо активирован\n+${m(pr.reward_foxes)}\n+${g(pr.reward_crystals)}`); }catch(e){ await client.query('ROLLBACK'); throw e; } finally{ client.release(); } });


// Extra command aliases: bank, direct facility actions, group fun
bot.hears(/^банк$/i, async ctx=>{ const u=await requireUser(ctx); await ctx.reply(`🏦 Банк\n\nНа руках: ${m(u.foxes)}\nВ банке: ${m(u.bank)}\n\nбанк положить 1000\nбанк положить все\nбанк снять 1000\nбанк снять все`); });
bot.hears(/^банк положить (\S+)$/i, async ctx=>{ const u=await requireUser(ctx); const amount=parseAmount(ctx.match[1],u); if(amount<1||Number(u.foxes)<amount) return ctx.reply('❌ Неверная сумма.'); await pool.query('UPDATE users SET foxes=foxes-$1, bank=bank+$1 WHERE id=$2',[amount,u.id]); await ctx.reply(`🏦 Положено: ${m(amount)}`); });
bot.hears(/^банк снять (\S+)$/i, async ctx=>{ const u=await requireUser(ctx); const raw=ctx.match[1].toLowerCase(); const amount=['все','all'].includes(raw)?Math.floor(Number(u.bank)):Number(raw); if(amount<1||Number(u.bank)<amount) return ctx.reply('❌ Неверная сумма.'); await pool.query('UPDATE users SET foxes=foxes+$1, bank=bank-$1 WHERE id=$2',[amount,u.id]); await ctx.reply(`🏦 Снято: ${m(amount)}`); });

bot.hears(/^(собрать прибыль|бизнес собрать|ферма собрать|сад собрать|генератор собрать|карьер собрать)$/i, async ctx=>{ const t=ctx.match[1].toLowerCase(); const kind=t.includes('ферм')?'farm':t.includes('сад')?'garden':t.includes('генератор')?'generator':t.includes('карьер')?'quarry':'business'; return collectFacility(ctx,kind); });
bot.hears(/^(оплатить налоги|бизнес налоги|ферма налоги|сад налоги)$/i, async ctx=>{ await ctx.reply('🦅 Налоги оплачиваются кнопкой внутри карточки постройки: открой «бизнес», «ферма» или «сад».'); });
bot.hears(/^купить видеокарту$/i, async ctx=>{ await ctx.reply('🎬 Открой «ферма» и нажми кнопку «Купить видеокарту».'); });
bot.hears(/^сад полить$/i, async ctx=>{ const u=await requireUser(ctx); await pool.query("UPDATE facilities SET water=max_water WHERE user_id=$1 AND kind='garden'",[u.id]); await markDaily(u.id,'garden_done'); await ctx.reply('💦 Сад полит.'); });
bot.hears(/^купить дерево$/i, async ctx=>{ await ctx.reply('🌳 Открой «сад» и нажми кнопку «Купить дерево».'); });
bot.hears(/^(увеличить бизнес|увеличить территорию|улучшить ферму)$/i, async ctx=>{ await ctx.reply('⬆️ Открой карточку постройки и нажми кнопку улучшения.'); });

bot.hears(/^(обнять|поцеловать|ударить)\s+(.+)$/i, ctx=>{ const act=ctx.match[1].toLowerCase(); const target=ctx.match[2]; const emoji=act==='обнять'?'🫂':act==='поцеловать'?'😘':'🥊'; ctx.reply(`${emoji} ${ctx.from.first_name} ${act} ${target}`); });
bot.hears(/^топ чата$/i, async ctx=>{ const r=await pool.query('SELECT username,first_name,foxes FROM users ORDER BY foxes DESC LIMIT 10'); await ctx.reply('🏆 Топ чата/бота\n\n'+r.rows.map((u,i)=>`${i+1}. ${u.username?'@'+u.username:u.first_name} — ${m(u.foxes)}`).join('\n')); });

bot.hears(/^магазин$/i, ctx=>ctx.reply('🏪 Магазин\n\nДоступно:\n• кейсы — команда «кейсы»\n• VIP — команда «vip»\n• постройки — бизнес, ферма, сад, генератор, карьер\n• зелья — команда «зелья»'));

bot.command('admin', async ctx=>{ if(!(await admin(ctx))) return; await ctx.reply('🛠 Админ-панель', Markup.inlineKeyboard([[Markup.button.callback('📊 Статистика','adm_stats'),Markup.button.callback('📢 Рассылка help','adm_help')],[Markup.button.callback('🧾 Логи','adm_logs')]])); });
bot.action('adm_stats', async ctx=>{ if(!(await admin(ctx))) return; const u=(await pool.query('SELECT COUNT(*) c FROM users')).rows[0].c; const tx=(await pool.query('SELECT COUNT(*) c FROM transactions')).rows[0].c; await ctx.reply(`📊 Статистика\nИгроков: ${u}\nТранзакций: ${tx}`); });
bot.action('adm_logs', async ctx=>{ if(!(await admin(ctx))) return; const r=await pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10'); await ctx.reply('🧾 Логи\n\n'+r.rows.map(x=>`${x.kind}: ${m(x.amount)} — ${x.meta||''}`).join('\n')); });
bot.action('adm_help', async ctx=>{ if(!(await admin(ctx))) return; return ctx.reply('/adm_give @user 1000 — выдать Фоксы\n/adm_give_id 123456789 1000 — выдать по ID\n/adm_take @user 1000 — забрать Фоксы\n/adm_set_foxes @user 1000000 — установить баланс\n/adm_crystals @user 10 — выдать кристаллы\n/adm_make_admin_id 123456789 — сделать админом в БД\n/adm_remove_admin_id 123456789 — убрать админа\n/adm_promo CODE FOXES CRYSTALS LIMIT\n/adm_broadcast текст\n/adm_ban @user\n/adm_unban @user'); });
bot.command('adm_give', async ctx=>{ if(!(await admin(ctx))) return; const [,who,amount]=ctx.message.text.split(/\s+/); const sum=Number(amount||0); if(!who||!sum) return ctx.reply('Используй: /adm_give @user 1000000'); const u=await getUserByAny(who); if(!u) return ctx.reply('Игрок не найден. Он должен хотя бы раз написать боту.'); await pool.query('UPDATE users SET foxes=foxes+$1 WHERE id=$2',[sum,u.id]); await logAdmin(ctx,'give_foxes',u.tg_id,sum,who); await ctx.reply(`✅ Выдано ${m(sum)} Фоксов игроку ${u.username?'@'+u.username:u.tg_id}.`); });
bot.command('adm_give_id', async ctx=>{ if(!(await admin(ctx))) return; const [,tgId,amount]=ctx.message.text.split(/\s+/); const sum=Number(amount||0); if(!tgId||!sum) return ctx.reply('Используй: /adm_give_id 123456789 1000000'); const r=await pool.query('UPDATE users SET foxes=foxes+$1 WHERE tg_id=$2 RETURNING *',[sum,tgId]); if(!r.rows[0]) return ctx.reply('Игрок не найден. Он должен хотя бы раз написать боту.'); await logAdmin(ctx,'give_foxes_id',Number(tgId),sum,'by tg_id'); await ctx.reply(`✅ Выдано ${m(sum)} Фоксов игроку ID ${tgId}.`); });
bot.command('adm_take', async ctx=>{ if(!(await admin(ctx))) return; const [,who,amount]=ctx.message.text.split(/\s+/); const sum=Math.abs(Number(amount||0)); if(!who||!sum) return ctx.reply('Используй: /adm_take @user 1000000'); const u=await getUserByAny(who); if(!u) return ctx.reply('Игрок не найден.'); await pool.query('UPDATE users SET foxes=GREATEST(foxes-$1,0) WHERE id=$2',[sum,u.id]); await logAdmin(ctx,'take_foxes',u.tg_id,sum,who); await ctx.reply(`✅ Списано ${m(sum)} Фоксов.`); });
bot.command('adm_set_foxes', async ctx=>{ if(!(await admin(ctx))) return; const [,who,amount]=ctx.message.text.split(/\s+/); const sum=Number(amount||0); if(!who||sum<0) return ctx.reply('Используй: /adm_set_foxes @user 1000000'); const u=await getUserByAny(who); if(!u) return ctx.reply('Игрок не найден.'); await pool.query('UPDATE users SET foxes=$1 WHERE id=$2',[sum,u.id]); await logAdmin(ctx,'set_foxes',u.tg_id,sum,who); await ctx.reply(`✅ Баланс установлен: ${m(sum)} Фоксов.`); });
bot.command('adm_crystals', async ctx=>{ if(!(await admin(ctx))) return; const [,who,amount]=ctx.message.text.split(/\s+/); const sum=Number(amount||0); if(!who||!sum) return ctx.reply('Используй: /adm_crystals @user 10'); const u=await getUserByAny(who); if(!u) return ctx.reply('Игрок не найден'); await pool.query('UPDATE users SET crystals=crystals+$1 WHERE id=$2',[sum,u.id]); await logAdmin(ctx,'give_crystals',u.tg_id,sum,who); await ctx.reply(`✅ Выдано ${m(sum)} Кристаллов.`); });
bot.command('adm_make_admin_id', async ctx=>{ if(!(await admin(ctx))) return; const [,tgId]=ctx.message.text.split(/\s+/); if(!tgId) return ctx.reply('Используй: /adm_make_admin_id 123456789'); const r=await pool.query('UPDATE users SET is_admin=TRUE WHERE tg_id=$1 RETURNING tg_id,username',[tgId]); if(!r.rows[0]) return ctx.reply('Игрок не найден. Он должен хотя бы раз написать боту.'); await logAdmin(ctx,'make_admin',Number(tgId),0,''); await ctx.reply(`✅ ID ${tgId} теперь админ в базе данных.`); });
bot.command('adm_remove_admin_id', async ctx=>{ if(!(await admin(ctx))) return; const [,tgId]=ctx.message.text.split(/\s+/); if(!tgId) return ctx.reply('Используй: /adm_remove_admin_id 123456789'); await pool.query('UPDATE users SET is_admin=FALSE WHERE tg_id=$1',[tgId]); await logAdmin(ctx,'remove_admin',Number(tgId),0,''); await ctx.reply(`✅ ID ${tgId} больше не админ в базе данных.`); });
bot.command('adm_promo', async ctx=>{ if(!(await admin(ctx))) return; const [,code,fox='0',cr='0',limit='100']=ctx.message.text.split(/\s+/); if(!code) return ctx.reply('/adm_promo CODE FOXES CR LIMIT'); await pool.query('INSERT INTO promo_codes(code,reward_foxes,reward_crystals,max_activations) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO UPDATE SET reward_foxes=$2,reward_crystals=$3,max_activations=$4',[code.toUpperCase(),fox,cr,limit]); await ctx.reply('Промо создан.'); });
bot.command('adm_broadcast', async ctx=>{ if(!(await admin(ctx))) return; const text=ctx.message.text.replace('/adm_broadcast','').trim(); if(!text) return ctx.reply('Текст?'); const r=await pool.query('SELECT tg_id FROM users WHERE is_banned=FALSE'); let ok=0; for(const row of r.rows){ try{ await ctx.telegram.sendMessage(row.tg_id,`📢 ${text}`); ok++; }catch{} } await ctx.reply(`Разослано: ${ok}`); });
bot.command(['adm_ban','adm_unban'], async ctx=>{ if(!(await admin(ctx))) return; const [,who]=ctx.message.text.split(/\s+/); const u=await getUserByAny(who); if(!u) return ctx.reply('Не найден'); await pool.query('UPDATE users SET is_banned=$1 WHERE id=$2',[ctx.message.text.startsWith('/adm_ban'),u.id]); await ctx.reply('OK'); });

bot.catch((err,ctx)=>{ console.error(err); ctx.reply?.('⚠️ Ошибка. Попробуй ещё раз или напиши админу.').catch(()=>{}); });
await initDb();
try{
  await bot.telegram.setMyCommands([
    {command:'start',description:'Запустить бота'},
    {command:'help',description:'Команды и меню'},
    {command:'profile',description:'Мой профиль'},
    {command:'balance',description:'Баланс'},
    {command:'casino',description:'Казино: /casino 1000'},
    {command:'business',description:'Мой бизнес'},
    {command:'farm',description:'Моя ферма'},
    {command:'garden',description:'Мой сад'},
    {command:'cases',description:'Кейсы'},
    {command:'clan',description:'Клан'},
    {command:'top',description:'Топ игроков'}
  ], { scope:{ type:'default' } });
  await bot.telegram.setMyCommands([
    {command:'help',description:'Команды группы'},
    {command:'profile',description:'Профиль'},
    {command:'balance',description:'Баланс'},
    {command:'casino',description:'Казино'},
    {command:'business',description:'Бизнес'},
    {command:'farm',description:'Ферма'},
    {command:'garden',description:'Сад'},
    {command:'cases',description:'Кейсы'},
    {command:'clan',description:'Клан'},
    {command:'top',description:'Топ игроков'},
    {command:'chat_top',description:'Топ чата'}
  ], { scope:{ type:'all_group_chats' } });
}catch(e){ console.warn('setMyCommands failed:', e.message); }

const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || `/telegram/${process.env.BOT_TOKEN}`;
const rawWebhookUrl = process.env.WEBHOOK_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');

async function startBot(){
  console.log('Checking database schema...');
  await initDb();
  console.log('Database schema is ready');

  if(rawWebhookUrl){
    const app = express();
    app.get('/', (_, res) => res.send(`${BOT_NAME} is alive`));
    app.get('/health', (_, res) => res.json({ ok:true, mode:'webhook' }));
    app.use(bot.webhookCallback(WEBHOOK_PATH));

    const fullWebhookUrl = `${rawWebhookUrl.replace(/\/$/, '')}${WEBHOOK_PATH}`;
    await bot.telegram.setWebhook(fullWebhookUrl, { drop_pending_updates: true });

    app.listen(PORT, () => {
      console.log(`${BOT_NAME} started in WEBHOOK mode`);
      console.log(`Webhook: ${fullWebhookUrl.replace(process.env.BOT_TOKEN, '***')}`);
    });
    return;
  }

  await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(()=>{});
  await bot.launch({ dropPendingUpdates: true });
  console.log(`${BOT_NAME} started in POLLING mode`);
}

startBot().catch(err=>{
  console.error('Fatal start error:', err);
  if(String(err?.description || err?.message || '').includes('409')){
    console.error('Telegram 409: этот токен уже запущен в другом процессе. На Railway используй WEBHOOK_URL или останови второй процесс.');
  }
  process.exit(1);
});

process.once('SIGINT',()=>bot.stop('SIGINT'));
process.once('SIGTERM',()=>bot.stop('SIGTERM'));
