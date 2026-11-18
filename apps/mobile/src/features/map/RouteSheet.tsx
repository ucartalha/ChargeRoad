import {useEffect,useMemo,useRef} from 'react';
import {Animated,PanResponder,Pressable,StyleSheet,Text,useWindowDimensions,View} from 'react-native';
import type {ReactNode} from 'react';
import {colors as c} from '../../theme';
const spring={useNativeDriver:true,damping:28,stiffness:240,mass:1} as const;
/** Bottom sheet with two snap points. Collapsing only moves the sheet: it never cancels work inside it.
 *  `peek` may change (e.g. a trip card appears); the sheet then glides to the new resting height. */
export function RouteSheet({children,expanded,onExpand,peek=215,title,subtitle,header=true}:{children:ReactNode;expanded:boolean;onExpand:(expanded:boolean)=>void;
  peek?:number;title?:string;subtitle?:string;header?:boolean}){
  const {height}=useWindowDimensions(),full=Math.max(400,height-100),travel=Math.max(0,full-peek);
  const offset=useRef(new Animated.Value(travel)).current,start=useRef(travel),current=useRef(travel),callback=useRef(onExpand);callback.current=onExpand;
  useEffect(()=>{const subscription=offset.addListener(({value})=>{current.current=value;});return()=>offset.removeListener(subscription);},[offset]);
  useEffect(()=>{Animated.spring(offset,{...spring,toValue:expanded?0:travel}).start();},[expanded,travel,offset]);
  const responder=useMemo(()=>PanResponder.create({onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dy)>4,
    onPanResponderGrant:()=>{offset.stopAnimation();start.current=current.current;},onPanResponderMove:(_,g)=>offset.setValue(Math.max(0,Math.min(travel,start.current+g.dy))),
    onPanResponderRelease:(_,g)=>{const open=g.vy<-.3||g.vy<=.3&&current.current<travel*.6;callback.current(open);
      Animated.spring(offset,{...spring,toValue:open?0:travel}).start();},
    onPanResponderTerminate:()=>Animated.spring(offset,{...spring,toValue:expanded?0:travel}).start()}),[travel,offset,expanded]);
  const showHeader=expanded||header;
  return <Animated.View testID="route-bottom-sheet" style={[s.sheet,{height:full,transform:[{translateY:offset}]}]}>
    <View {...responder.panHandlers} style={s.handleArea}><View style={s.handle}/></View>
    {showHeader&&<Pressable accessibilityRole="button" accessibilityLabel={expanded?'Rota ayarlarını küçült':'Rota ayarlarını aç'} onPress={()=>onExpand(!expanded)} style={s.titleRow}>
      <View style={{flex:1}}><Text style={s.title}>{title??(expanded?'Yolculuğun sana göre.':'Nereye gidiyoruz?')}</Text>
        <Text style={s.subtitle}>{subtitle??(expanded?'Rotanı seç, gerisini birlikte planlayalım.':'Rotan, şarjın ve molaların bir arada.')}</Text></View>
      <View style={[s.chevron,expanded&&s.chevronOpen]}><Text style={s.arrow}>⌃</Text></View>
    </Pressable>}
    {children}
  </Animated.View>;
}
const s=StyleSheet.create({sheet:{position:'absolute',left:0,right:0,bottom:0,backgroundColor:c.background,borderTopLeftRadius:30,borderTopRightRadius:30,elevation:12,shadowColor:'#12382A',shadowOpacity:.15,shadowRadius:20,shadowOffset:{width:0,height:-4}},
  handleArea:{height:27,alignItems:'center',justifyContent:'center'},handle:{width:38,height:4,borderRadius:3,backgroundColor:'#C6D0C9'},titleRow:{paddingHorizontal:23,paddingBottom:16,flexDirection:'row',alignItems:'center',gap:12},
  title:{fontSize:23,fontWeight:'800',color:c.ink,letterSpacing:-.7},subtitle:{fontSize:12,color:c.muted,marginTop:5},
  chevron:{width:36,height:36,borderRadius:18,backgroundColor:c.softGreen,alignItems:'center',justifyContent:'center'},chevronOpen:{transform:[{rotate:'180deg'}]},arrow:{fontSize:18,color:c.green,marginTop:4}});
