import {useEffect,useMemo,useRef} from 'react';
import {AccessibilityInfo,Animated,Easing,StyleSheet,Text,View} from 'react-native';
import type {ClientRoutePlan as RoutePlan} from '../../api/plan-view';
import {socSkyline} from './trip-summary';
import {colors as c} from '../../theme';

const BARS=28,HEIGHT=58;
/** The trip's battery as a skyline: columns drain along the road and jump up at charging stops.
 *  Without a plan the same columns breathe as a wave, so waiting and answer share one picture. */
export function EnergySkyline({plan,start,arrival}:{plan:RoutePlan|null;start?:string;arrival?:string}){
  const bars=useMemo(()=>plan?socSkyline(plan,BARS):null,[plan]);
  const grow=useRef(Array.from({length:BARS},()=>new Animated.Value(.18))).current,wave=useRef(new Animated.Value(0)).current;
  useEffect(()=>{let reduced=false,stopped=false;let loop:Animated.CompositeAnimation|null=null;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{reduced=value;if(stopped)return;
      if(bars){wave.stopAnimation();const targets=bars.map(b=>Math.max(.06,b.soc/100));
        if(reduced)targets.forEach((t,i)=>grow[i].setValue(t));
        else Animated.stagger(18,targets.map((t,i)=>Animated.spring(grow[i],{toValue:t,useNativeDriver:false,speed:14,bounciness:6}))).start();}
      else if(!reduced){loop=Animated.loop(Animated.timing(wave,{toValue:1,duration:1400,easing:Easing.inOut(Easing.sin),useNativeDriver:false}));wave.setValue(0);loop.start();}
    }).catch(()=>{});
    return()=>{stopped=true;loop?.stop();};
  },[bars,grow,wave]);
  return <View accessible accessibilityLabel={bars?`Batarya yolculuk boyunca ${start??''} başlangıçtan ${arrival??''} varışa; ${bars.filter(b=>b.stop).length} şarj molası`:'Batarya planı hesaplanıyor'}>
    <View style={s.chart}>
      {grow.map((value,i)=>{
        const height=bars?value.interpolate({inputRange:[0,1],outputRange:[0,HEIGHT]}):
          wave.interpolate({inputRange:[0,.5,1],outputRange:[0,1,0].map(k=>HEIGHT*(.18+.42*Math.abs(Math.sin((i/BARS+k*.5)*Math.PI))))});
        const bar=bars?.[i];
        return <View key={i} style={s.slot}>
          {bar?.stop&&<View style={s.bolt}><Text style={s.boltText}>⚡</Text></View>}
          <Animated.View style={[s.bar,{height},bar?.stop?s.stopBar:bar&&bar.soc<20?s.lowBar:null,!bars&&s.waitBar]}/>
        </View>;})}
    </View>
    {bars&&<View style={s.labels}><Text style={s.label}>{start}</Text><Text style={s.label}>{arrival}</Text></View>}
  </View>;
}
const s=StyleSheet.create({chart:{height:HEIGHT+14,flexDirection:'row',alignItems:'flex-end',gap:3},slot:{flex:1,height:'100%',alignItems:'center',justifyContent:'flex-end'},
  bar:{width:'100%',borderRadius:3,backgroundColor:'#5FBF97'},stopBar:{backgroundColor:c.lime},lowBar:{backgroundColor:c.orange},waitBar:{backgroundColor:'#3D6B58'},
  bolt:{position:'absolute',top:-2,zIndex:1},boltText:{fontSize:10},labels:{flexDirection:'row',justifyContent:'space-between',marginTop:6},label:{color:'#BFD5C9',fontSize:10,fontWeight:'700',letterSpacing:.6}});
