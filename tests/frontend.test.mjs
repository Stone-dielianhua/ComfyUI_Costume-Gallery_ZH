import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterItems, readLocal, writeLocal } from '../js/lib/store.js';

const items = JSON.parse(readFileSync(new URL('../data/costume-zh.json', import.meta.url)));
const aliases = JSON.parse(readFileSync(new URL('../data/meta-zh.json', import.meta.url))).同义词;
const state = {query:'',category:'',type:'',color:'',collection:'all'};
test('all 1407 records and eight category counts', () => {
    assert.equal(filterItems(items,state).length,1407);
    assert.equal(filterItems(items,{...state,category:'春季'}).length,215);
});
test('bilingual AND search, exact ID and English prefix', () => {
    assert.deepEqual(filterItems(items,{...state,query:'SPR-0001 ivory'}).map(i=>i.id),['SPR-0001']);
    assert.ok(filterItems(items,{...state,query:'连衣裙 白色'},[],[],aliases).length>0);
    const found=filterItems(items,{...state,query:'sweat'});
    assert.ok(found.length>0);
    assert.ok(found.every(i=>/\bsweat/i.test(i.关键词)));
});
test('type and color combine without matching dress inside address', () => {
    const fixtures=[{id:'a',分类:'春季',关键词:'white dress',关键词中文:'白色'}, {id:'b',分类:'春季',关键词:'white address',关键词中文:'白色'}];
    assert.deepEqual(filterItems(fixtures,{...state,type:'dress',color:'white'}).map(i=>i.id),['a']);
});
test('Chinese synonyms find original English tokens', () => {
    const fixtures=[{id:'a',分类:'春季',关键词:'navy dress',关键词中文:'藏蓝色'}];
    assert.equal(filterItems(fixtures,{...state,query:'深蓝'},[],[],{'深蓝':['navy']}).length,1);
});
test('favorites and recents preserve intended order', () => {
    assert.deepEqual(filterItems(items,{...state,collection:'favorites'},['SPR-0001']).map(i=>i.id),['SPR-0001']);
    assert.deepEqual(filterItems(items,{...state,collection:'recent'},[],['SPR-0002','SPR-0001']).map(i=>i.id),['SPR-0002','SPR-0001']);
});
test('storage is isolated from pose gallery and survives invalid data', () => {
    const storage=new Map();
    globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
    storage.set('pose-gallery-zh.v1.favorites.builtin','["pose"]');
    writeLocal('favorites.builtin',['SPR-0001']);
    assert.deepEqual(readLocal('favorites.builtin',[]),['SPR-0001']);
    assert.equal(storage.get('pose-gallery-zh.v1.favorites.builtin'),'["pose"]');
    storage.set('costume-gallery-zh.v1.favorites.builtin','[null,123,"ok"]');
    assert.deepEqual(readLocal('favorites.builtin',[]),['ok']);
    storage.set('costume-gallery-zh.v1.favorites.builtin','{broken');
    assert.deepEqual(readLocal('favorites.builtin',[]),[]);
});
